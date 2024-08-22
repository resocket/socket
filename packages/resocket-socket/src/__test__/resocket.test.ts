/**
 * @vitest-environment jsdom
 */

import { expect, beforeEach, afterEach, it, vitest } from "vitest";
import NodeWebSocket from "ws";
import { DEFAULT, ReSocket } from "../resocket";
import { StopRetry } from "../errors";
import { MockWindow } from "./_setup";

const WebSocketServer = NodeWebSocket.Server;
const originalWebSocket = global.WebSocket;
let socketServer: NodeWebSocket.Server<typeof NodeWebSocket.WebSocket>;
let mockWindow: MockWindow;

const PORT = 45789;
const URL = `ws://localhost:${PORT}/`;
const ERROR_URL = "ws://localhost:32423";

beforeEach(() => {
  mockWindow = new MockWindow();
  (global as any).window = mockWindow;
  (global as any).WebSocket = originalWebSocket;
  socketServer = new WebSocketServer({ port: PORT });
});

afterEach(() => {
  vitest.restoreAllMocks();
  vitest.useRealTimers();

  return new Promise((resolve) => {
    socketServer.clients.forEach((client) => {
      client.terminate();
    });
    socketServer.removeAllListeners();
    socketServer.close(() => {
      resolve();
    });
  });
});

//jest style done https://vitest.dev/guide/migration#done-callback
function itDone(
  name: string,
  fn: (resolve: () => void, reject: (e: unknown) => void) => void,
  timeout?: number
) {
  it(
    name,
    () =>
      new Promise<void>((resolve, reject) => {
        fn(resolve, reject);
      }),
    timeout
  );
}

const realSetTimeout = globalThis.setTimeout;
function sleep(
  ms: number,
  { bypassFakeTimers }: { bypassFakeTimers: boolean } = {
    bypassFakeTimers: false,
  }
) {
  return new Promise((resolve) => {
    if (bypassFakeTimers) {
      realSetTimeout(resolve, ms);
      return;
    }

    setTimeout(resolve, ms);
  });
}
it("throws if not created with `new`", () => {
  expect(() => {
    // @ts-ignore
    ReSocket(URL, undefined);
  }).toThrow(TypeError);
});

itDone("should throw if invalid url", (done) => {
  const connection = new ReSocket(ERROR_URL, []);

  connection.addEventListener("error", () => {
    connection.close();
    done();
  });
});

itDone("should initialize resocket", (done) => {
  const connection = new ReSocket(URL);

  connection.addEventListener("open", () => {
    connection.close();
    done();
  });
});

it("[config] should respect startClosed", () => {
  const connection = new ReSocket(URL, [], { startClosed: true });
  expect(connection.getStatus()).toBe("initial");
});

itDone("should reconnect on connection lose", (done) => {
  let firstConnection: boolean = true;

  socketServer.on("connection", (con) => {
    if (firstConnection) {
      firstConnection = false;
      con.close();
    }
  });

  const connection = new ReSocket(URL, [], { startClosed: true });

  const expectedStateSequence = [
    "auth",
    "connection",
    "connected",
    "auth",
    "connection",
    "connected",
  ];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", (state) => {
    recievedStateSequence.push(state);

    if (recievedStateSequence.length == 6) {
      expect(expectedStateSequence).toEqual(recievedStateSequence);
      connection.close();
      done();
    }
  });
  connection.reconnect();
});

itDone("[config] should respect  closeCodes", (done) => {
  socketServer.once("connection", (con) => {
    con.close(4000);
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    closeCodes: 4000,
  });

  const expectedStateSequence = ["auth", "connection", "connected", "closed"];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", (state) => {
    recievedStateSequence.push(state);
  });

  connection.addEventListener("statusChange", (status) => {
    if (status === "closed") {
      expect(expectedStateSequence).toEqual(recievedStateSequence);
      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone("[config] should respect connectionTimeout", (done) => {
  vitest.useFakeTimers();

  const logSpy = vitest.spyOn(console, "log").mockImplementation(() => {});
  const connectionTimeout = 3000;
  const connection = new ReSocket(ERROR_URL, [], {
    debug: true, //! logspy on don't remove
    startClosed: true,
    connectionTimeout,
  });

  const expectedStateSequence = ["auth", "connection", "connection_backoff"];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);

    if (recievedStateSequence.length === 3) {
      vitest.useRealTimers();
      await sleep(10);
      expect(logSpy).toHaveBeenCalledTimes(4);
      expect(logSpy).toHaveBeenLastCalledWith("RS>", "timeout error");
      expect(expectedStateSequence).toEqual(recievedStateSequence);
      connection.close();
      done();
    }
  });

  connection.reconnect();
  vitest.advanceTimersByTime(connectionTimeout);
});

itDone("[config] should respect params", (done) => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    params: async () => {
      return {
        data: "ninja hattori",
      };
    },
  });

  connection.addEventListener("statusChange", async (status) => {
    if (status === "connected") {
      expect(connection.url).toBe(`${URL}?data=ninja+hattori`);
      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone("[config] should respect paramsTimeout", (done) => {
  vitest.useFakeTimers();

  const logSpy = vitest.spyOn(console, "log").mockImplementation(() => {});
  const paramsTimeout = 3000;
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    debug: true, //!logspy on don't remove
    params: async () => {
      await sleep(paramsTimeout + 100);
      return {
        data: "ben 10",
      };
    },
    paramsTimeout,
  });

  const expectedStateSequence = ["auth", "auth_backoff"];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);

    if (recievedStateSequence.length === 2) {
      vitest.useRealTimers();
      await sleep(10);
      expect(logSpy).toHaveBeenCalledTimes(3);
      expect(logSpy).toHaveBeenLastCalledWith("RS>", "timeout error");
      expect(expectedStateSequence).toEqual(recievedStateSequence);
      connection.close();
      done();
    }
  });

  connection.reconnect();
  vitest.advanceTimersByTime(paramsTimeout);
});

itDone("should handle params failure and retry", (done) => {
  let firstTry = true;

  const connection = new ReSocket(URL, [], {
    maxReconnectionDelay: 0, //speed up the reconnection
    startClosed: true,
    params: async () => {
      if (firstTry) {
        firstTry = false;
        throw new Error("Something went wrong with auth");
      }
      return {
        data: "ben 10",
      };
    },
  });

  const expectedStateSequence = [
    "auth",
    "auth_backoff",
    "auth",
    "connection",
    "connected",
  ];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);
    if (recievedStateSequence.length == 5) {
      expect(expectedStateSequence).toEqual(recievedStateSequence);
      //!note _internalStateChange will notify before state is changed, so if we close websocket from here the socket may not be defined
      //! this will throw an error. only in this edge case which is supposed to internal used only
      await sleep(1);
      connection.close();
      done();
    }
  });
  connection.reconnect();
});

itDone("should respect StopRetry error and move to failed", (done) => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    params: async () => {
      throw new StopRetry("failure frame manga is good");
    },
  });

  const expectedStateSequence = ["auth", "auth_backoff", "failed"];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);
  });

  connection.addEventListener("disconnect", () => {
    expect(expectedStateSequence).toEqual(recievedStateSequence);
    done();
  });

  connection.reconnect();
});

itDone(
  "should notify on lost connection - slow initial connection",
  async (done) => {
    vitest.useFakeTimers();

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      //!NOTE - js runtimes. do not handle setTimeout's with infinity. dont use them
      paramsTimeout: 999999,
      lostConnectionTimeout: 3000,
      params: async () => {
        await sleep(1000000);
        return {};
      },
    });

    let hasNotified = false;
    connection.addEventListener("lostConnection", () => {
      hasNotified = true;
    });

    connection.reconnect();

    vitest.advanceTimersByTime(1000);
    expect(hasNotified).toBeFalsy();

    vitest.advanceTimersByTime(10000);
    expect(hasNotified).toBeTruthy();

    connection.close();
    done();
  }
);

itDone("should notify on lost connection - slow reconnection", async (done) => {
  let firstConnection = true;

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    maxReconnectionDelay: 0,
    //!NOTE - js runtimes. do not handle setTimeout's with infinity. dont use them
    paramsTimeout: 999999,
    connectionTimeout: 99999,
    lostConnectionTimeout: 3000,
    params: async () => {
      if (firstConnection) {
        firstConnection = false;
        return {};
      }

      await sleep(1000000);
      return {};
    },
  });

  let LostConnectionStatus: undefined | any = undefined;
  connection.addEventListener("lostConnection", (event) => {
    LostConnectionStatus = event;
  });

  connection.addEventListener("statusChange", (status) => {
    if (status === "connected") {
      vitest.useFakeTimers();
      connection.reconnect();

      vitest.advanceTimersByTime(100);
      expect(LostConnectionStatus).toBeUndefined();

      vitest.advanceTimersByTime(4000);
      expect(LostConnectionStatus).toBe("lost");

      connection.close();
      expect(LostConnectionStatus).toBe("failed");

      done();
    }
  });

  connection.reconnect();
});

itDone("[default] should not send ping", async (done) => {
  let pingCount = 0;

  vitest.useFakeTimers();
  socketServer.on("connection", (con) => {
    con.addEventListener("message", (e) => {
      if (e.data === "ping") {
        pingCount++;
        con.send("pong");
      }
    });
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
  });

  connection.addEventListener("statusChange", async (status) => {
    if (status === "connected") {
      expect(pingCount).toBe(0);

      vitest.advanceTimersByTime(10000);
      await sleep(5, { bypassFakeTimers: true });
      expect(pingCount).toBe(0);

      vitest.advanceTimersByTime(10000);
      await sleep(5, { bypassFakeTimers: true });
      expect(pingCount).toBe(0);

      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone(
  "[config] should respect heartbeatInterval - send ping",
  async (done) => {
    let pingCount = 0;

    vitest.useFakeTimers();
    socketServer.on("connection", (con) => {
      con.addEventListener("message", (e) => {
        if (e.data === "ping") {
          pingCount++;
          con.send("pong");
        }
      });
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      heartbeatInterval: 1000,
    });

    connection.addEventListener("statusChange", async (status) => {
      if (status === "connected") {
        expect(pingCount).toBe(0);

        vitest.advanceTimersByTime(1000);
        await sleep(5, { bypassFakeTimers: true });
        expect(pingCount).toBe(1);

        vitest.advanceTimersByTime(1000);
        await sleep(5, { bypassFakeTimers: true });
        expect(pingCount).toBe(2);

        vitest.advanceTimersByTime(500);
        await sleep(5, { bypassFakeTimers: true });
        expect(pingCount).toBe(2);

        connection.close();
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(`[default] should timeout the ping`, async (done) => {
  vitest.useFakeTimers();
  socketServer.on("connection", (con) => {
    con.addEventListener("message", async (e) => {
      if (e.data === "ping") {
        vitest.advanceTimersByTime(DEFAULT.pingTimeout);
        con.send("pong");
      }
    });
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    heartbeatInterval: 1000,
  });

  const expectedStateSequence = [
    "auth",
    "connection",
    "connected",
    "ping",
    "ping_backoff",
    "auth_backoff",
  ];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("statusChange", (status) => {
    if (status === "connected") {
      vitest.advanceTimersByTime(1005);
    }
  });

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);

    if (recievedStateSequence.length == 6) {
      expect(expectedStateSequence).toEqual(recievedStateSequence);

      //!note closing form _internalStateChange can cause errors in socket state. it is known and not an issue, _internalStateChange is not meant for using outside testcases & debugging
      await sleep(5, { bypassFakeTimers: true });
      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone("[config] should respect pingTimeout", async (done) => {
  vitest.useFakeTimers();
  socketServer.on("connection", (con) => {
    con.addEventListener("message", (e) => {
      if (e.data === "ping") {
        con.send("pong");
      }
    });
  });

  const connection = new ReSocket(URL, ["test"], {
    startClosed: true,
    heartbeatInterval: 1000,
    pingTimeout: DEFAULT.pingTimeout + 1,
  });
  const expectedStateSequence = [
    "auth",
    "connection",
    "connected",
    "ping",
    "connected",
  ];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("statusChange", (status) => {
    if (status === "connected") {
      vitest.advanceTimersByTime(1000);
    }
  });

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);

    if (recievedStateSequence.length == 5) {
      expect(expectedStateSequence).toEqual(recievedStateSequence);

      //! dont close without async in _internalStateChange
      await sleep(2, { bypassFakeTimers: true });
      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone(
  "[config] should respect maxMissedPings - case auth_backoff",
  async (done) => {
    vitest.useFakeTimers();
    socketServer.on("connection", (con) => {
      con.addEventListener("message", async (e) => {
        if (e.data === "ping") {
          vitest.advanceTimersByTime(DEFAULT.pingTimeout);
          con.send("pong");
        }
      });
    });

    const connection = new ReSocket(URL, ["culprit"], {
      startClosed: true,
      heartbeatInterval: 1000,
      maxMissedPingss: 2,
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connected",
      "ping",
      "ping_backoff",
      "ping",
      "ping_backoff",
      "auth_backoff",
    ];

    const recievedStateSequence: string[] = [];

    connection.addEventListener("statusChange", (status) => {
      if (status === "connected") {
        vitest.advanceTimersByTime(1000);
      }
    });

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);

      if (recievedStateSequence.length == 8) {
        expect(expectedStateSequence).toEqual(recievedStateSequence);
        //! dont close without async in _internalStateChange
        await sleep(2, { bypassFakeTimers: true });
        connection.close();

        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect maxMissedPings - case connected",
  async (done) => {
    vitest.useFakeTimers();

    let firstPing = true;
    socketServer.on("connection", (con) => {
      con.addEventListener("message", async (e) => {
        if (e.data === "ping") {
          if (firstPing) {
            firstPing = false;
            vitest.advanceTimersByTime(DEFAULT.pingTimeout);
          }
          con.send("pong");
        }
      });
    });

    const connection = new ReSocket(URL, ["ccc"], {
      startClosed: true,
      heartbeatInterval: 1000,
      maxMissedPingss: 2,
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connected",
      "ping",
      "ping_backoff",
      "ping",
      "connected",
    ];

    const recievedStateSequence: string[] = [];

    connection.addEventListener("statusChange", (status) => {
      if (status === "connected") {
        vitest.advanceTimersByTime(1000);
      }
    });

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);

      if (recievedStateSequence.length == 7) {
        expect(expectedStateSequence).toEqual(recievedStateSequence);
        //! dont close without async in _internalStateChange
        await sleep(2, { bypassFakeTimers: true });

        connection.close();
        done();
      }
    });

    connection.reconnect();
  }
);

itDone("[config] should respect pingMessage", async (done) => {
  let pingCount = 0;

  const pingMessage = "scooby dooby doo";

  vitest.useFakeTimers();
  socketServer.on("connection", (con) => {
    con.addEventListener("message", (e) => {
      if (e.data === pingMessage) {
        pingCount++;
        con.send("pong");
      }
    });
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    heartbeatInterval: 1000,
    pingMessage,
  });

  connection.addEventListener("statusChange", async (status) => {
    if (status === "connected") {
      expect(pingCount).toBe(0);

      vitest.advanceTimersByTime(1000);
      await sleep(5, { bypassFakeTimers: true });
      expect(pingCount).toBe(1);

      vitest.advanceTimersByTime(1000);
      await sleep(5, { bypassFakeTimers: true });
      expect(pingCount).toBe(2);

      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone("[config] should respect pongMessage", async (done) => {
  let pingCount = 0;

  const pongMessage = "scooby dooby doo";

  vitest.useFakeTimers();
  socketServer.on("connection", (con) => {
    con.addEventListener("message", (e) => {
      if (e.data === "ping") {
        pingCount++;
        con.send(pongMessage);
      }
    });
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    heartbeatInterval: 1000,
    pongMessage,
  });

  connection.addEventListener("statusChange", async (status) => {
    if (status === "connected") {
      expect(pingCount).toBe(0);

      vitest.advanceTimersByTime(1000);
      await sleep(5, { bypassFakeTimers: true });
      expect(pingCount).toBe(1);

      vitest.advanceTimersByTime(1000);
      await sleep(5, { bypassFakeTimers: true });
      expect(pingCount).toBe(2);

      connection.close();
      done();
    }
  });

  connection.reconnect();
});

itDone(
  "[default] should not send ping on network events - heartbeat is off",
  async (done) => {
    const connection = new ReSocket(URL, [], {
      startClosed: true,
    });

    const expectedStateSequence = ["auth", "connection", "connected"];

    const recievedStateSequence: string[] = [];

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", async (status) => {
      if (status === "connected") {
        expect(expectedStateSequence).toEqual(recievedStateSequence);

        mockWindow.notify("offline");
        expect(recievedStateSequence.includes("ping")).toBeFalsy();
        connection.close();
        done();
      }
    });
    connection.reconnect();
  }
);

itDone(
  "[default] should send ping on network events - heartbeat is set",
  async (done) => {
    const connection = new ReSocket(URL, [], {
      startClosed: true,
      heartbeatInterval: 1000,
    });

    const expectedStateSequence = ["auth", "connection", "connected"];

    const recievedStateSequence: string[] = [];

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", async (status) => {
      if (status === "connected") {
        expect(expectedStateSequence).toEqual(recievedStateSequence);

        mockWindow.notify("offline");
        expect(recievedStateSequence.includes("ping")).toBeTruthy();
        connection.close();
        done();
      }
    });
    connection.reconnect();
  }
);

itDone("[config] should respect ignoreNetworkEvent", async (done) => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    heartbeatInterval: 1000,
    ignoreNetworkEvents: true,
  });

  const expectedStateSequence = ["auth", "connection", "connected"];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);
  });

  connection.addEventListener("statusChange", async (status) => {
    if (status === "connected") {
      expect(expectedStateSequence).toEqual(recievedStateSequence);

      mockWindow.notify("offline");
      expect(recievedStateSequence.includes("ping")).toBeFalsy();
      connection.close();
      done();
    }
  });
  connection.reconnect();
});

itDone(
  "[default] should not send ping on focus events - heartbeat is off",
  async (done) => {
    const connection = new ReSocket(URL, [], {
      startClosed: true,
    });

    const expectedStateSequence = ["auth", "connection", "connected"];

    const recievedStateSequence: string[] = [];

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", async (status) => {
      if (status === "connected") {
        expect(expectedStateSequence).toEqual(recievedStateSequence);

        mockWindow.notify("focus");
        expect(recievedStateSequence.includes("ping")).toBeFalsy();
        connection.close();
        done();
      }
    });
    connection.reconnect();
  }
);

itDone(
  "[default] should send ping on focus events - heartbeat is set",
  async (done) => {
    const connection = new ReSocket(URL, [], {
      startClosed: true,
      heartbeatInterval: 1000,
    });

    const expectedStateSequence = ["auth", "connection", "connected"];

    const recievedStateSequence: string[] = [];

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", async (status) => {
      if (status === "connected") {
        expect(expectedStateSequence).toEqual(recievedStateSequence);

        mockWindow.notify("focus");
        expect(recievedStateSequence.includes("ping")).toBeTruthy();
        connection.close();
        done();
      }
    });
    connection.reconnect();
  }
);

itDone("[config] should respect ignoreFocusEvent", async (done) => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    heartbeatInterval: 1000,
    ignoreFocusEvents: true,
  });

  const expectedStateSequence = ["auth", "connection", "connected"];

  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);
  });

  connection.addEventListener("statusChange", async (status) => {
    if (status === "connected") {
      expect(expectedStateSequence).toEqual(recievedStateSequence);

      mockWindow.notify("focus");
      expect(recievedStateSequence.includes("ping")).toBeFalsy();
      connection.close();
      done();
    }
  });
  connection.reconnect();
});

itDone("[config] should respect maxRetries", async (done) => {
  const connnection = new ReSocket(ERROR_URL, [], {
    startClosed: true,
    maxRetries: 3,
    maxReconnectionDelay: 0,
  });

  const expectedStateSequence = [
    "auth",
    "connection",
    "connection_backoff",
    "auth",
    "connection",
    "connection_backoff",
    "auth",
    "connection",
    "connection_backoff",
    "failed",
  ];

  const recievedStateSequence: string[] = [];

  connnection.addEventListener("_internalStateChange", (state) => {
    recievedStateSequence.push(state);
  });

  connnection.addEventListener("disconnect", () => {
    expect(recievedStateSequence).toEqual(expectedStateSequence);
    done();
  });

  connnection.reconnect();
});

itDone("[behaviour] should test close inside 'open' callback", (done) => {
  const logSpy = vitest.spyOn(console, "log").mockImplementation(() => {});

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    debug: true, //!logspy on - don't clear
  });

  let first = true;

  const expectedStateSequence = ["auth", "connection", "closed"];
  const recievedStateSequence: string[] = [];

  connection.addEventListener("_internalStateChange", (state) => {
    recievedStateSequence.push(state);
  });

  connection.addEventListener("open", () => {
    if (first) {
      connection.close();
      first = false;
    }
  });

  connection.addEventListener("disconnect", async () => {
    //! await for the logs to be called. and the connection to be cleaned up from the socketServer
    await sleep(20, { bypassFakeTimers: true });

    expect(expectedStateSequence).toEqual(recievedStateSequence);

    expect(logSpy).toHaveBeenCalledTimes(4);
    expect(logSpy.mock.calls[logSpy.mock.calls.length - 2]).toEqual([
      "RS>",
      "closing websocket",
    ]);

    expect(socketServer.clients.size).toBe(0);
    done();
  });

  connection.reconnect();
});

itDone("[behaviour] should test reconnect inside 'open' callback", (done) => {
  const logSpy = vitest.spyOn(console, "log").mockImplementation(() => {});
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    debug: true, //!logspy on - don't clear
  });

  let first = true;

  const expectedStateSequence = [
    "auth",
    "connection",
    "auth",
    "connection",
    "connected",
  ];
  const recievedStateSequence: string[] = [];

  connection.addEventListener("open", () => {
    if (first) {
      connection.reconnect();
      first = false;
    }
  });

  connection.addEventListener("_internalStateChange", async (state) => {
    recievedStateSequence.push(state);

    if (recievedStateSequence.length === 5) {
      //! await for the logs to be called. and the connection to be cleaned up from the socketServer
      await sleep(20, { bypassFakeTimers: true });
      expect(expectedStateSequence).toEqual(recievedStateSequence);

      //! since we're awaiting 20ms above we will already be in a connected state. so a log transion for that
      expect(logSpy).toHaveBeenCalledTimes(6);
      expect(logSpy.mock.calls[2]).toEqual(["RS>", "closing websocket"]);

      connection.close();

      done();
    }
  });

  connection.reconnect();
});

itDone("[config] should respect debugLogger", (done) => {
  const warnSpy = vitest.spyOn(console, "warn").mockImplementation(() => {});

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    debug: true, //! debug used for test
    debugLogger: (...args) => {
      console.warn(`CUSTOM> `, ...args);
    },
  });

  connection.addEventListener("statusChange", (status) => {
    if (status === "connected") {
      expect(warnSpy).toHaveBeenCalledTimes(3);

      expect(
        warnSpy.mock.calls.filter((args) => {
          return !!args.includes("CUSTOM>");
        }).length
      ).toBe(0);

      connection.close();
      done();
    }
  });

  connection.reconnect();
});

//! testing this first since the remaining tests are dependent on this config behaviour
itDone("[config] should respect minReconnectionDelay", async (done) => {
  vitest.useFakeTimers();

  const minReconnectionDelay = 5000;
  let numTries = 5;

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    minReconnectionDelay,
    params: async () => {
      if (numTries > 0) {
        numTries--;
        throw new Error("Grand blue dreaming~");
      }

      return { info: "kyou kara ore wa. (live action)" };
    },
  });

  const expectedDelays: Array<number> = [minReconnectionDelay];
  for (let i = 0; i < 4; i++) {
    expectedDelays.push(
      Math.min(
        minReconnectionDelay *
          Math.pow(DEFAULT.reconnectionDelayGrowFactor, i + 1),
        DEFAULT.maxReconnectionDelay
      )
    );
  }

  //@ts-expect-error -- accessing private property
  const delaySpy = vitest.spyOn(connection, "_getNextDelay");

  connection.addEventListener("_internalStateChange", async (state) => {
    if (state === "auth_backoff") {
      await sleep(1, { bypassFakeTimers: true });
      vitest.advanceTimersByTime(100000);
    }
  });
  connection.addEventListener("open", () => {
    expect(expectedDelays).toEqual(
      delaySpy.mock.results.map((res) => res.value)
    );

    connection.close();
    done();
  });

  connection.reconnect();
});

itDone(
  "[default] [behaviour] should increase the reconnection delay by the grow factor",
  (done) => {
    vitest.useFakeTimers();

    const minReconnectionDelay = 2000;
    let numTries = 10;

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      minReconnectionDelay, //!note the default config is randomized so we're using this as a stable base value
      params: async () => {
        if (numTries > 0) {
          numTries--;
          throw new Error("Ninja Boy Rantaro-");
        }

        return { info: "disastrous life of saiki k." };
      },
    });

    const expectedDelays: Array<number> = [minReconnectionDelay];
    for (let i = 0; i < 9; i++) {
      expectedDelays.push(
        Math.min(
          minReconnectionDelay *
            Math.pow(DEFAULT.reconnectionDelayGrowFactor, i + 1),
          DEFAULT.maxReconnectionDelay
        )
      );
    }

    //@ts-expect-error -- accessing private property
    const delaySpy = vitest.spyOn(connection, "_getNextDelay");

    connection.addEventListener("_internalStateChange", async (state) => {
      if (state === "auth_backoff") {
        await sleep(1, { bypassFakeTimers: true });
        vitest.advanceTimersByTime(100000);
      }
    });
    connection.addEventListener("open", () => {
      expect(expectedDelays).toEqual(
        delaySpy.mock.results.map((res) => res.value)
      );

      connection.close();
      done();
    });

    connection.reconnect();
  }
);

itDone("[config] should respect reconnectionDelayGrowFactor", async (done) => {
  vitest.useFakeTimers();

  const minReconnectionDelay = 2000;
  const reconnectionDelayGrowFactor = 1.5;
  let numTries = 10;

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    reconnectionDelayGrowFactor,
    minReconnectionDelay, //!note the default config is randomized so we're using this as a stable base value
    params: async () => {
      if (numTries > 0) {
        numTries--;
        throw new Error("Slam Dunk!");
      }

      return { info: "bakuman!" };
    },
  });

  const expectedDelays: Array<number> = [minReconnectionDelay];
  for (let i = 0; i < 9; i++) {
    expectedDelays.push(
      Math.min(
        minReconnectionDelay * Math.pow(reconnectionDelayGrowFactor, i + 1),
        DEFAULT.maxReconnectionDelay
      )
    );
  }

  //@ts-expect-error -- accessing private property
  const delaySpy = vitest.spyOn(connection, "_getNextDelay");

  connection.addEventListener("_internalStateChange", async (state) => {
    if (state === "auth_backoff") {
      await sleep(1, { bypassFakeTimers: true });
      vitest.advanceTimersByTime(100000);
    }
  });
  connection.addEventListener("open", () => {
    expect(expectedDelays).toEqual(
      delaySpy.mock.results.map((res) => res.value)
    );

    connection.close();
    done();
  });

  connection.reconnect();
});

itDone("[config] should respect maxReconnectionDelay", async (done) => {
  vitest.useFakeTimers();

  const maxReconnectionDelay = 20000;
  const minReconnectionDelay = 1000;
  let numTries = 10;

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    maxReconnectionDelay,
    minReconnectionDelay, //!note the default config is randomized so we're using this as a stable base value
    params: async () => {
      if (numTries > 0) {
        numTries--;
        throw new Error("Black clover");
      }

      return { info: "boku no hero academia" };
    },
  });

  const expectedDelays: Array<number> = [minReconnectionDelay];
  for (let i = 0; i < 9; i++) {
    expectedDelays.push(
      Math.min(
        minReconnectionDelay *
          Math.pow(DEFAULT.reconnectionDelayGrowFactor, i + 1),
        maxReconnectionDelay
      )
    );
  }

  //@ts-expect-error -- accessing private property
  const delaySpy = vitest.spyOn(connection, "_getNextDelay");

  connection.addEventListener("_internalStateChange", async (state) => {
    if (state === "auth_backoff") {
      await sleep(1, { bypassFakeTimers: true });
      vitest.advanceTimersByTime(100000);
    }
  });
  connection.addEventListener("open", () => {
    expect(expectedDelays).toEqual(
      delaySpy.mock.results.map((res) => res.value)
    );

    connection.close();
    done();
  });

  connection.reconnect();
});

itDone("[config] should respect getDelay", async (done) => {
  vitest.useFakeTimers();

  let numTries = 10;

  const expectedDelays: number[] = [];

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    getDelay: () => {
      const delay = Math.random() * Math.random();
      expectedDelays.push(delay);
      return delay;
    },
    params: async () => {
      if (numTries > 0) {
        numTries--;

        //honourable mention to LOOKISM ;_;
        throw new Error("Kuroko no basuke");
      }

      //honourable mention to ELECEED ;_;
      return { info: "Yowamushi pedal" };
    },
  });

  //@ts-expect-error -- accessing private property
  const delaySpy = vitest.spyOn(connection, "_getNextDelay");

  connection.addEventListener("_internalStateChange", async (state) => {
    if (state === "auth_backoff") {
      await sleep(1, { bypassFakeTimers: true });
      vitest.advanceTimersByTime(100000);
    }
  });
  connection.addEventListener("open", () => {
    expect(expectedDelays).toEqual(
      delaySpy.mock.results.map((res) => res.value)
    );

    connection.close();
    done();
  });

  connection.reconnect();
});

itDone(
  "[default] [behaviour] should not buffer messages - case 1 (send before connecting)",
  (done) => {
    let serverRecievedMessagesCount = 0;
    socketServer.addListener("connection", (con) => {
      con.addEventListener("message", () => {
        serverRecievedMessagesCount++;
      });
    });

    const connection = new ReSocket(URL, [], { startClosed: true });

    connection.send("hello");
    connection.send("hey");

    connection.reconnect();
    connection.addEventListener("open", async () => {
      //await for the messages to reach the server (in this case they should not btw)
      await sleep(1);

      expect(serverRecievedMessagesCount).toBe(0);

      connection.close();
      done();
    });
  }
);

itDone(
  "[default] [behaviour] should not buffer messages - case 2 (offline send, connect, send, offline send, connect, send)",
  (done) => {
    let serverRecievedMessages: Array<any> = [];
    socketServer.addListener("connection", (con) => {
      con.addEventListener("message", (e) => {
        serverRecievedMessages.push(e.data);
      });
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
    });

    connection.send("hello");
    connection.send("hey");

    connection.reconnect();

    let firstOpen = true;
    connection.addEventListener("open", async () => {
      if (firstOpen) {
        firstOpen = false;
        connection.send("lookism");
        connection.send("eleceed");

        //await for the messages to reach the server (in this case they should not btw)
        await sleep(5);

        expect(serverRecievedMessages.length).toBe(2);
        expect(serverRecievedMessages).toEqual(["lookism", "eleceed"]);
        connection.close();

        connection.send("offline - ");
        connection.send("offline - ");

        connection.reconnect();
        return;
      }

      //waiitng for the messages to reach the server
      await sleep(5);

      connection.send("one piece");
      connection.send("dragon ball");

      //waiting for messages to reach the server
      await sleep(5);

      expect(serverRecievedMessages.length).toBe(4);

      expect(serverRecievedMessages).toEqual([
        "lookism",
        "eleceed",
        "one piece",
        "dragon ball",
      ]);

      connection.close();

      done();
    });
  }
);

itDone("[config] should respect buffer - case boolean", (done) => {
  let serverRecievedMessages: Array<any> = [];
  socketServer.addListener("connection", (con) => {
    con.addEventListener("message", (e) => {
      serverRecievedMessages.push(e.data);
    });
  });

  const connection = new ReSocket(URL, [], { startClosed: true, buffer: true });

  connection.send("kaiju no 8");
  connection.send("jujutsu kaisen");

  connection.reconnect();

  let firstOpen = true;
  connection.addEventListener("open", async () => {
    if (firstOpen) {
      firstOpen = false;
      connection.send("lookism");
      connection.send("eleceed");

      //await for the messages to reach the server (in this case they should not btw)
      await sleep(5);

      expect(serverRecievedMessages.length).toBe(4);
      expect(serverRecievedMessages).toEqual([
        "kaiju no 8",
        "jujutsu kaisen",
        "lookism",
        "eleceed",
      ]);
      connection.close();

      connection.send("teenage mercenary");
      connection.send("tower of god");

      connection.reconnect();
      return;
    }

    //waiitng for the messages to reach the server
    await sleep(5);

    connection.send("one piece");
    connection.send("dragon ball");
    //waiting for messages to reach the server
    await sleep(5);

    expect(serverRecievedMessages.length).toBe(8);

    expect(serverRecievedMessages).toEqual([
      "kaiju no 8",
      "jujutsu kaisen",
      "lookism",
      "eleceed",
      "teenage mercenary",
      "tower of god",
      "one piece",
      "dragon ball",
    ]);

    connection.close();
    done();
  });
});

itDone("[config] should respect buffer - case maxEnqueueMessage", (done) => {
  let serverRecievedMessages: Array<any> = [];
  socketServer.addListener("connection", (con) => {
    con.addEventListener("message", (e) => {
      serverRecievedMessages.push(e.data);
    });
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    buffer: { maxEnqueuedMessages: 1 },
  });

  connection.send("kaiju no 8");
  connection.send("jujutsu kaisen");

  connection.reconnect();

  let firstOpen = true;
  connection.addEventListener("open", async () => {
    if (firstOpen) {
      firstOpen = false;
      connection.send("lookism");
      connection.send("eleceed");

      //await for the messages to reach the server (in this case they should not btw)
      await sleep(5);

      expect(serverRecievedMessages.length).toBe(3);
      expect(serverRecievedMessages).toEqual([
        "kaiju no 8",
        "lookism",
        "eleceed",
      ]);
      connection.close();

      connection.send("teenage mercenary");
      connection.send("tower of god");

      connection.reconnect();
      return;
    }

    //waiitng for the messages to reach the server
    await sleep(5);

    connection.send("one piece");
    connection.send("dragon ball");
    //waiting for messages to reach the server
    await sleep(5);

    expect(serverRecievedMessages.length).toBe(6);

    expect(serverRecievedMessages).toEqual([
      "kaiju no 8",
      "lookism",
      "eleceed",
      "teenage mercenary",
      "one piece",
      "dragon ball",
    ]);

    connection.close();

    done();
  });
});

itDone("[behaviour] should notify connection status properly", (done) => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
  });

  const recievedConnectionStatuses: string[] = [];

  connection.addEventListener("statusChange", (status) => {
    recievedConnectionStatuses.push(status);
  });

  let firstOpen = true;
  connection.addEventListener("open", async () => {
    if (firstOpen) {
      firstOpen = false;

      await sleep(1);

      expect(recievedConnectionStatuses.length).toBe(2);
      expect(recievedConnectionStatuses).toEqual(["connecting", "connected"]);
      connection.close();

      await sleep(1);

      expect(recievedConnectionStatuses.length).toBe(3);
      expect(recievedConnectionStatuses).toEqual([
        "connecting",
        "connected",
        "closed",
      ]);

      connection.reconnect();
      await sleep(20);

      expect(recievedConnectionStatuses.length).toBe(5);
      expect(recievedConnectionStatuses).toEqual([
        "connecting",
        "connected",
        "closed",
        "reconnecting",
        "connected",
      ]);

      connection.close();
      done();

      return;
    }
  });

  connection.reconnect();
});

//todo at last add behaviour based test cases ~
itDone("[behaviour] should connect, send data, recieve data, close", (done) => {
  socketServer.addListener("connection", (con) => {
    con.addEventListener("message", (e) => {
      con.send(`[echo] ${e.data}`);
    });
  });
  const connection = new ReSocket(URL, [], {
    startClosed: true,
    params: async () => {
      return {
        move: "crazy cyclone",
      };
    },
    buffer: true,
  });

  connection.addEventListener("message", async (e) => {
    expect(e.data).toBe(`[echo] gomu gomu no... pistol!`);
    expect(connection.url).toBe(URL + "?move=crazy+cyclone");

    connection.close();

    await sleep(5);
    expect(connection.getStatus()).toBe("closed");
    expect(socketServer.clients.size).toBe(0);

    done();
  });

  connection.send("gomu gomu no... pistol!");

  connection.reconnect();
});
itDone(
  "[behaviour] should connect, send data, recieve, close, reconnect, send data, close",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.addEventListener("message", (e) => {
        con.send(`[echo] ${e.data}`);
      });
    });
    const connection = new ReSocket(URL, [], {
      startClosed: true,
      params: async () => {
        return {
          move: "crazy cyclone",
        };
      },
      buffer: true,
    });

    let firstMessage = true;

    connection.addEventListener("message", async (e) => {
      if (firstMessage) {
        firstMessage = false;
        expect(e.data).toBe(`[echo] gomu gomu no... pistol!`);
        expect(connection.url).toBe(URL + "?move=crazy+cyclone");

        connection.close();

        await sleep(5);
        expect(connection.getStatus()).toBe("closed");
        expect(socketServer.clients.size).toBe(0);

        connection.send("gomu gomu no... rocket!");
        connection.reconnect();
        expect(connection.getStatus()).toBe("reconnecting");

        return;
      }

      expect(e.data).toBe("[echo] gomu gomu no... rocket!");
      expect(connection.getStatus()).toBe("connected");
      connection.close();

      await sleep(5);
      expect(connection.getStatus()).toBe("closed");
      expect(socketServer.clients.size).toBe(0);

      done();
    });

    connection.send("gomu gomu no... pistol!");

    connection.reconnect();
    expect(connection.getStatus()).toBe("connecting");
  }
);

itDone("[property] should give correct buffered amount", async (done) => {
  const connection = new ReSocket(URL, [], { buffer: true });

  connection.send("hello");
  connection.send("hey");

  expect(connection.bufferedAmount).toBe(8);

  connection.addEventListener("open", async () => {
    //let the buffer drain
    await sleep(1);
    expect(connection.bufferedAmount).toBe(0);
    connection.close();
    done();
  });

  connection.reconnect();
});

itDone(
  "[config] should respect buildUrl - case 1 (without reconnect)",
  (done) => {
    socketServer.on("connection", (_con, req) => {
      expect(req.url).toBe("/anime=inazuma+eleven");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      url: ({ url }) => {
        return url + "anime=inazuma+eleven";
      },
    });

    connection.addEventListener("open", () => {
      expect(connection.url).toBe(URL + "anime=inazuma+eleven");
      connection.close();
      done();
    });

    connection.reconnect();
  }
);

itDone("[config] should respect buildUrl - case 1 (with reconnect)", (done) => {
  const serverRecievedUrls: Array<string> = [];

  socketServer.on("connection", (_con, req) => {
    serverRecievedUrls.push(req.url as string);
  });

  const URLs = ["anime=inazuma+eleven", "webtoon=manager+kim"];

  let connectionCounter = 0;

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    url: ({ url }) => {
      const dynamicUrl = url + URLs[connectionCounter];
      connectionCounter++;
      return dynamicUrl;
    },
  });

  let firstTry = true;
  connection.addEventListener("open", async () => {
    if (firstTry) {
      firstTry = false;

      expect(connection.url).toBe(URL + URLs[0]);
      expect(serverRecievedUrls).toEqual(["/anime=inazuma+eleven"]);
      connection.reconnect();

      return;
    }

    expect(connection.url).toBe(URL + URLs[1]);
    expect(serverRecievedUrls).toEqual([
      "/anime=inazuma+eleven",
      "/webtoon=manager+kim",
    ]);

    connection.close();
    done();
  });

  connection.reconnect();
});

itDone("[property] onopen should work", (done) => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
  });

  connection.onopen = () => {
    connection.close();
    done();
  };
  connection.reconnect();
});

itDone("[property] onmessage should work", (done) => {
  socketServer.addListener("connection", (con) => {
    con.send("anime - failure frame");
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
  });

  connection.onmessage = (e) => {
    expect(e.data).toBe("anime - failure frame");
    connection.close();
    done();
  };
  connection.reconnect();
});

itDone("[property] onclose should work", (done) => {
  socketServer.addListener("connection", (con) => {
    con.close(4000);
  });

  const connection = new ReSocket(URL, [], {
    startClosed: true,
    closeCodes: [4000],
  });

  connection.onclose = (e) => {
    connection.close();
    done();
  };
  connection.reconnect();
});

itDone("[property] onerror should work", (done) => {
  const connection = new ReSocket(ERROR_URL, [], {
    startClosed: true,
  });

  connection.onerror = (e) => {
    connection.close();
    done();
  };
  connection.reconnect();
});

itDone(
  "[config] should respect connectionResolver - varaition 1 (non async. success)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      unstable_connectionResolver: (con, resolver, rejecter) => {
        con.addEventListener("message", (e) => {
          if (e.data !== "hello") rejecter();

          resolver();
        });
      },
    });

    connection.addEventListener("message", () => {
      connection.close();
      done();
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 2 (non-async, fail)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      maxRetries: 2,
      maxReconnectionDelay: 0,
      unstable_connectionResolver: (con, resolver, rejecter) => {
        rejecter();
      },
    });

    let didRecieveMessage = false;

    connection.addEventListener("message", (e) => {
      didRecieveMessage = true;
    });

    connection.addEventListener("_internalStateChange", (state) => {
      if (state === "failed") {
        expect(didRecieveMessage).toBeFalsy();
        //@ts-expect-error -- internal private property access
        expect(connection._bufferedMessages.length).toBe(2);
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 3 (non-async, fail then pass)",
  (done) => {
    let counter = 0;
    socketServer.addListener("connection", (con, req) => {
      con.send("hello " + counter);
      counter++;
    });

    let firstTry = true;

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      maxReconnectionDelay: 0,

      unstable_connectionResolver: (_con, resolver, rejecter) => {
        if (firstTry) {
          firstTry = false;
          rejecter();
          return;
        }
        resolver();
      },
    });

    let recievedMessages: Array<string> = [];

    connection.addEventListener("message", (e) => {
      recievedMessages.push(e.data);
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connection_backoff",
      "auth",
      "connection",
      "connected",
    ];

    const recievedStateSequence: Array<string> = [];

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);
      if (recievedStateSequence.length === 5) {
        expect(recievedMessages.length).toBe(0);

        //@ts-expect-error -- internal private property access
        expect(connection._bufferedMessages.length).toBe(1);
      }

      if (recievedStateSequence.length === 6) {
        await sleep(1);
        expect(recievedMessages.length).toBe(2);
        expect(recievedMessages).toEqual(["hello 0", "hello 1"]);

        //@ts-expect-error -- internal private property access
        expect(connection._bufferedMessages.length).toBe(0);

        expect(expectedStateSequence).toEqual(recievedStateSequence);

        connection.close();
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 4 (non-async, StopRetry)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      unstable_connectionResolver: (con, resolver, rejecter) => {
        //inazuma eleven season 2 opening. the alien arc
        rejecter(
          new StopRetry(
            "Tsuyoku, nareta ze hitori ga dekinakata. bokutachi ga~"
          )
        );
      },
    });

    connection.addEventListener("statusChange", (status) => {
      if (status === "disconnected") {
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 5 (async, fail)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      maxRetries: 2,
      maxReconnectionDelay: 0,
      unstable_connectionResolver: async (con, resolver, rejecter) => {
        await sleep(15);

        //inazuma eleven season 2 opening. the alien arc
        rejecter();
      },
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connection_backoff",
      "auth",
      "connection",
      "connection_backoff",
      "failed",
    ];

    const recievedStateSequence: Array<string> = [];

    connection.addEventListener("_internalStateChange", (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", (status) => {
      if (status === "disconnected") {
        //@ts-expect-error -- accessing private property
        expect(connection._bufferedMessages.length).toBe(2);
        expect(expectedStateSequence).toEqual(recievedStateSequence);
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 6 (async,  success)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      unstable_connectionResolver: async (con, resolver, rejecter) => {
        await sleep(15);

        resolver();
      },
    });

    connection.addEventListener("message", () => {
      connection.close();
      done();
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 7 (async, fail then pass)",
  (done) => {
    let counter = 0;
    socketServer.addListener("connection", (con, req) => {
      con.send("hello " + counter);
      counter++;
    });

    let firstTry = true;

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      maxReconnectionDelay: 0,

      unstable_connectionResolver: async (_con, resolver, rejecter) => {
        await sleep(5);
        if (firstTry) {
          firstTry = false;
          rejecter();
          return;
        }
        resolver();
      },
    });

    let recievedMessages: Array<string> = [];

    connection.addEventListener("message", (e) => {
      recievedMessages.push(e.data);
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connection_backoff",
      "auth",
      "connection",
      "connected",
    ];

    const recievedStateSequence: Array<string> = [];

    connection.addEventListener("_internalStateChange", async (state) => {
      recievedStateSequence.push(state);
      if (recievedStateSequence.length === 5) {
        expect(recievedMessages.length).toBe(0);

        //@ts-expect-error -- internal private property access
        expect(connection._bufferedMessages.length).toBe(1);
      }

      if (recievedStateSequence.length === 6) {
        await sleep(1);
        expect(recievedMessages.length).toBe(2);
        expect(recievedMessages).toEqual(["hello 0", "hello 1"]);

        //@ts-expect-error -- internal private property access
        expect(connection._bufferedMessages.length).toBe(0);

        expect(expectedStateSequence).toEqual(recievedStateSequence);

        connection.close();
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variation 8 (async, StopRetry)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      unstable_connectionResolver: async (con, resolver, rejecter) => {
        await sleep(2);
        //inazuma eleven season 2 opening. the alien arc
        rejecter(
          new StopRetry(
            "Tsuyoku, nareta ze hitori ga dekinakata. bokutachi ga~"
          )
        );
      },
    });

    connection.addEventListener("message", () => {
      //we should not recieve messages till the connection is connected
      expect(true).toBeFalsy();
    });

    connection.addEventListener("statusChange", (status) => {
      if (status === "disconnected") {
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver = variatoin 9 (async after timeout, fail)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      maxRetries: 2,
      connectionTimeout: 10,
      maxReconnectionDelay: 0,
      unstable_connectionResolver: async (con, resolver, rejecter) => {
        await sleep(15);

        rejecter();
      },
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connection_backoff",
      "auth",
      "connection",
      "connection_backoff",
      "failed",
    ];

    const recievedStateSequence: Array<string> = [];

    connection.addEventListener("_internalStateChange", (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", (status) => {
      if (status === "disconnected") {
        //@ts-expect-error -- accessing private property
        expect(connection._bufferedMessages.length).toBe(2);
        expect(expectedStateSequence).toEqual(recievedStateSequence);
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver = variatoin 10 (async after timeout, success)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,
      maxRetries: 2,
      connectionTimeout: 15,
      maxReconnectionDelay: 0,
      unstable_connectionResolver: async (con, resolver, rejecter) => {
        await sleep(20);

        //this wont work and would be nooped
        resolver();
      },
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connection_backoff",
      "auth",
      "connection",
      "connection_backoff",
      "failed",
    ];

    const recievedStateSequence: Array<string> = [];

    connection.addEventListener("_internalStateChange", (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("statusChange", (status) => {
      if (status === "disconnected") {
        //@ts-expect-error -- accessing private property
        expect(connection._bufferedMessages.length).toBe(2);
        expect(expectedStateSequence).toEqual(recievedStateSequence);
        done();
      }
    });

    connection.reconnect();
  }
);

itDone(
  "[config] should respect connectionResolver - variatoin 11 (async after timeout, StopRetry)",
  (done) => {
    socketServer.addListener("connection", (con) => {
      con.send("hello");
    });

    const connection = new ReSocket(URL, [], {
      startClosed: true,

      connectionTimeout: 0,
      maxReconnectionDelay: 0,
      maxRetries: 2,
      unstable_connectionResolver: async (con, resolver, rejecter) => {
        await sleep(1);
        //inazuma eleven season 2 opening. the alien arc
        rejecter(
          new StopRetry(
            "Tsuyoku, nareta ze hitori ga dekinakata. bokutachi ga~"
          )
        );
      },
    });

    const expectedStateSequence = [
      "auth",
      "connection",
      "connection_backoff",
      "auth",
      "connection",
      "connection_backoff",
      "failed",
    ];

    const recievedStateSequence: Array<string> = [];

    connection.addEventListener("_internalStateChange", (state) => {
      recievedStateSequence.push(state);
    });

    connection.addEventListener("message", () => {
      expect(true).toBeFalsy();
    });

    connection.addEventListener("statusChange", (status) => {
      if (status === "disconnected") {
        expect(expectedStateSequence).toEqual(recievedStateSequence);
        done();
      }
    });

    connection.reconnect();
  }
);

it("[property] stop should work", () => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
  });

  connection.stop();

  expect(() => connection.reconnect()).toThrow(Error);
  expect(() => connection.close()).toThrow(Error);
});

it("[property] isUsable should work", () => {
  const connection = new ReSocket(URL, [], {
    startClosed: true,
  });

  expect(connection.isUsable()).toBeTruthy();
  connection.stop();

  expect(connection.isUsable()).toBeFalsy();
});
