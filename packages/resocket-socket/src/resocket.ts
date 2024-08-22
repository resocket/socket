import { StopRetry, TimeoutError } from "./errors";
import { CustomEventTarget } from "./event-target";
import { CloseEvent, ErrorEvent } from "./events";
import { cloneEvent, timeoutPromise } from "./uitls";

export interface WebSocketEventMap {
  open: Event;
  message: MessageEvent;
  error: ErrorEvent;
  close: CloseEvent;

  //todo heh, improve this type
  disconnect: CloseEvent | ErrorEvent | StopRetry | undefined;

  statusChange: Status;
  lostConnection: LostConnectionStatus;

  _internalStateChange: State;
}

type State =
  | "initial"
  | "auth"
  | "auth_backoff"
  | "connection"
  | "connection_backoff"
  | "connected"
  | "ping"
  | "ping_backoff"
  | "failed"
  | "closed"
  | "stopped";

export type Status =
  | "initial"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "closed";

export type LostConnectionStatus = "lost" | "restored" | "failed";

type RetryInfo = {
  retryCount: number;
  paramsRetryCount: number;
  connectionRetryCount: number;
};

//todo improve this type
type StateDataMap = {
  initial: undefined;
  auth: undefined;
  auth_backoff: any;
  connection: any;
  connection_backoff: any;
  connected: WebSocket;
  failed: Error;
  closed: any;
  ping: undefined;
  ping_backoff: undefined;
  stopped: undefined;
};

export type ReSocketOptions = {
  url?: (info: {
    retryInfo: RetryInfo;
    url: string | URL;
    params: any;
  }) => string;
  params?: (info: RetryInfo) => Promise<object>;

  //todo maybe mark this as experimental? - or hide behind advanced config :/
  unstable_connectionResolver?: (
    con: WebSocket,
    resolver: () => void,
    rejecter: (err?: any) => void
  ) => Promise<void> | void;

  //todo add a proper type for the websocket interface
  polyfills?: { WebSocket: any };

  //retries related,
  maxReconnectionDelay?: number;
  minReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
  //a custom delay that will override the above config if provide this argument, useful for more customized delays
  getDelay?: (retryCount: number) => number;
  maxRetries?: number;

  //connection related
  connectionTimeout?: number;
  paramsTimeout?: number;

  //application related
  startClosed?: boolean;
  lostConnectionTimeout?: number;
  closeCodes?: number | number[];

  buffer?: boolean | { maxEnqueuedMessages: number };

  // heartbeat related
  heartbeatInterval?: number;
  maxMissedPingss?: number;
  ignoreFocusEvents?: boolean;
  ignoreNetworkEvents?: boolean;
  pingTimeout?: number; //timeout to wait for the pong message after sending the ping
  pingMessage?: string;
  pongMessage?: string;

  //debug
  debug?: boolean;
  debugLogger?: (...args: any[]) => void;
};

type LostConnection = {
  lostConnectionTimeout?: ReturnType<typeof setTimeout>; //timeout for when a connection is lost
  didLoseConnection: boolean;
};

export const DEFAULT = {
  //todo change this to query maybe
  paramsTimeout: 10000,
  connectionTimeout: 10000,
  maxRetries: Infinity,
  buffer: { maxEnqueuedMessages: 0 }, //same as no buffering, by default we don't buffer
  pingTimeout: 3000,
  maxMissedPings: 0,
  ignoreFocusEvents: false,
  ignoreNetworkEvents: false,
  pingMessage: "ping",
  pongMessage: "pong",
  lostConnectionTimeout: 5000,
  maxReconnectionDelay: 10000,
  minReconnectionDelay: 1000 + Math.random() * 4000,
  reconnectionDelayGrowFactor: 1.3,
};

export type Message = string | ArrayBuffer | Blob | ArrayBufferView;

export class ReSocket extends CustomEventTarget<WebSocketEventMap> {
  private _state: State = "initial";
  private _cleanupFns: Array<(() => void) | undefined> = [];
  private _socket: WebSocket | null = null;
  private _lostConnection: LostConnection = { didLoseConnection: false };

  private _binaryType: BinaryType = "blob";
  private _successCounter = 0;
  private _paramsRetryCount = 0;
  private _connectionRetryCount = 0;
  private _missedPingsCount = 0;
  private _enqueuedMessages: Array<Message> = [];
  private _bufferedMessages: Array<MessageEvent> = [];

  private _status: Status = "initial";
  private get _retryCount() {
    return this._paramsRetryCount + this._connectionRetryCount;
  }
  private _options: ReSocketOptions;
  private _debugLogger = console.log.bind(console);
  private WebSocket: typeof WebSocket = WebSocket;

  private _lastMessageSent: number = 0;

  constructor(
    private _url: string | URL,
    private _protocols: string | string[] | undefined = undefined,
    options: ReSocketOptions = {}
  ) {
    super();

    this._options = options;

    if (this._options.debugLogger)
      this._debugLogger = this._options.debugLogger;

    if (options.polyfills) {
      if (options.polyfills.WebSocket)
        this.WebSocket = options.polyfills.WebSocket;
    }

    //log the error message if no WebSocket implementation available, and no polyfill was provided either
    if (!this.WebSocket) {
      console.error(`
        ‼️ No WebSocket implementation available. You should define options.WebSocket. 

        For example, if you're using node.js, run \`npm install ws\`, and then in your code:

        import {ReSocket} from '@resocket/socket';
        import WS from 'ws';

        const resocket = new ReSocket('wss://localhost:1999', {
            polyfills: {
                WebSocket: WS
            }
        })
        `);
    }

    this.attachWindowEvents();

    this.addEventListener("statusChange", this.handleLostConnection);

    if (!this._options.startClosed) this.transition("auth");
  }

  static get CONNECTING() {
    return 0;
  }
  static get OPEN() {
    return 1;
  }
  static get CLOSING() {
    return 2;
  }
  static get CLOSED() {
    return 3;
  }

  get CONNECTING() {
    return ReSocket.CONNECTING;
  }
  get OPEN() {
    return ReSocket.OPEN;
  }
  get CLOSING() {
    return ReSocket.CLOSING;
  }
  get CLOSED() {
    return ReSocket.CLOSED;
  }

  get binaryType() {
    return this._socket ? this._socket.binaryType : this._binaryType;
  }

  set binaryType(value: BinaryType) {
    this._binaryType = value;
    if (this._socket) {
      this._socket.binaryType = value;
    }
  }

  get retryCount(): number {
    return Math.max(this._retryCount, 0);
  }

  get bufferedAmount(): number {
    const bytes = this._enqueuedMessages.reduce((acc, message) => {
      if (typeof message === "string") {
        acc += message.length; // not byte size
      } else if (message instanceof Blob) {
        acc += message.size;
      } else {
        acc += message.byteLength;
      }
      return acc;
    }, 0);

    return bytes + (this._socket ? this._socket.bufferedAmount : 0);
  }

  get extensions(): string {
    return this._socket ? this._socket.extensions : "";
  }

  get protocol(): string {
    return this._socket ? this._socket.protocol : "";
  }

  get readyState(): number {
    if (this._socket) {
      return this._socket.readyState;
    }

    const status = this.getStatus();

    return ["closed", "failed", "diconnected"].includes(status)
      ? ReSocket.CLOSED
      : ReSocket.CONNECTING;
  }

  get url(): string {
    return this._socket ? this._socket.url : "";
  }

  private _getNextDelay() {
    //if this is a function that means we need to override via this
    if (typeof this._options.getDelay === "function") {
      return this._options.getDelay(this._retryCount);
    }

    const {
      minReconnectionDelay = DEFAULT.minReconnectionDelay,
      maxReconnectionDelay = DEFAULT.maxReconnectionDelay,
      reconnectionDelayGrowFactor = DEFAULT.reconnectionDelayGrowFactor,
    } = this._options;

    let delay = 0;
    if (this._retryCount > 0) {
      delay =
        minReconnectionDelay *
        Math.pow(reconnectionDelayGrowFactor, this._retryCount - 1);
      if (delay > maxReconnectionDelay) {
        delay = maxReconnectionDelay;
      }
    }

    return delay;
  }

  private authentication() {
    const { params, paramsTimeout = DEFAULT.paramsTimeout } = this._options;

    if (!params) {
      this.transition("connection");
      return;
    }

    return this.transitionAsync({
      handler: timeoutPromise(
        params({
          retryCount: this._retryCount,
          connectionRetryCount: this._connectionRetryCount,
          paramsRetryCount: this._paramsRetryCount,
        }),
        paramsTimeout,
        "params timeout"
      ),
      nextState: "connection",
      errorState: "auth_backoff",
    });
  }

  private authenticationError(error: any) {
    this._paramsRetryCount++;
    this._missedPingsCount = 0;

    const { maxRetries = DEFAULT.maxRetries } = this._options;

    if (error instanceof TimeoutError) this._debug("timeout error");

    //if the user threw a stop retry, we'll moved to failed
    if (error instanceof StopRetry) {
      this.transition("failed", error);
      return;
    }

    //max auth retry reached
    if (this._retryCount >= maxRetries) {
      this.transition("failed", new StopRetry("max retry attempt reached"));
      return;
    }

    const timeout = setTimeout(() => {
      this.transition("auth");
    }, this._getNextDelay());

    return () => {
      clearTimeout(timeout);
    };
  }

  private onSocketOpen = (event: Event) => {
    //todo maybe we should send the messages on the transition to connected?
    this._enqueuedMessages.forEach((msg) => {
      this._socket!.send(msg);
    });
    this._enqueuedMessages = [];
    this._lastMessageSent = Date.now();

    if (this.onopen) {
      this.onopen(event);
    }

    this.dispatchEvent("open", cloneEvent(event));
  };

  private onSocketError = (event: Event) => {
    if (this.onerror) {
      this.onerror(event as ErrorEvent);
    }

    //dispatch the event
    this.dispatchEvent("error", cloneEvent(event) as ErrorEvent);

    //here we take it as the socket is still usable
    //? maybe send this to ping/pong just to make sure.
    if (this._socket?.readyState === 1) return;

    // we try reconnect, on our side, if it's anything other than connected we don't do anything
    if (
      this._state === "connected" ||
      this._state === "ping" ||
      this._state === "ping_backoff"
    )
      this.transition("auth");
  };

  private onSocketClose = (event: CloseEvent) => {
    if (this.onclose) {
      this.onclose(event);
    }

    //dispatch the event
    this.dispatchEvent("close", cloneEvent(event) as CloseEvent);

    const { closeCodes } = this._options;

    if (typeof closeCodes !== "undefined") {
      const closeCodesArray =
        typeof closeCodes === "number" ? [closeCodes] : closeCodes;

      for (let code of closeCodesArray) {
        if (event.code === code) {
          //our signal to stop retry
          this.transition("closed");
          return;
        }
      }
    }

    // we try reconnect, on our side, if it's anything other than connected we don't do anything
    if (
      this._state === "connected" ||
      this._state === "ping" ||
      this._state === "ping_backoff"
    )
      this.transition("auth");
  };

  private onSocketMessage = (
    event: MessageEvent<any>,
    force: boolean = false
  ) => {
    if (
      (this._socket !== null && this._bufferedMessages.length > 0 && !force) ||
      (this._options.unstable_connectionResolver && this._socket === null)
    ) {
      this._debug("[buffering] added to buffer ", event.data);

      this._bufferedMessages.push(event);
      return;
    }

    if (this.onmessage) {
      this.onmessage(event);
    }
    this.dispatchEvent("message", cloneEvent(event) as MessageEvent);
  };

  //helper
  private addSocketEventListeners(socket: WebSocket) {
    socket.addEventListener("open", this.onSocketOpen);
    socket.addEventListener("message", this.onSocketMessage);
    socket.addEventListener("close", this.onSocketClose);
    socket.addEventListener("error", this.onSocketError);
  }

  //helper
  private removeSocketEventListeners(socket: WebSocket) {
    socket.removeEventListener("open", this.onSocketOpen);
    socket.removeEventListener("message", this.onSocketMessage);
    socket.removeEventListener("close", this.onSocketClose);
    socket.removeEventListener("error", this.onSocketError);
  }

  private closeSocket(socket: WebSocket) {
    socket.close();
    this.removeSocketEventListeners(socket);
  }

  private async _connectSocket(url: string | URL) {
    const { connectionTimeout = DEFAULT.connectionTimeout } = this._options;
    let con: WebSocket | null = null;
    let cleanupRejectRef: (v: any) => void;
    let stateChangeListenerRef: (v: any) => void;

    const connectSock = new Promise<WebSocket>((resolve, reject) => {
      const stateChangeListener = () => {
        reject("status changes abort");
      };

      stateChangeListenerRef = stateChangeListener;

      this.addEventListener("_internalStateChange", stateChangeListener);

      const conn = new WebSocket(url, this._protocols);
      con = conn;

      const cleanupReject = (e: any) => {
        reject(conn);
      };

      cleanupRejectRef = cleanupReject;

      conn.addEventListener("open", (e) => {
        const resolver = () => {
          conn.removeEventListener("close", cleanupReject);
          conn.removeEventListener("error", cleanupReject);
          this.removeEventListener("_internalStateChange", stateChangeListener);

          //! should be cleanedup by the cleanups
          this._socket = con;

          resolve(conn);
        };

        //! we let connectionResolver resolve the connection instead.
        if (this._options.unstable_connectionResolver) {
          this._options.unstable_connectionResolver(conn, resolver, reject);
          return;
        }

        resolver();
      });

      conn.addEventListener("close", cleanupReject);
      conn.addEventListener("error", cleanupReject);

      //these will still be called on unstable_connectionResolver
      this.addSocketEventListeners(conn);
    });

    try {
      const con = await timeoutPromise<WebSocket>(
        connectSock,
        connectionTimeout,
        "connection timeout"
      );

      return con;
    } catch (error) {
      this.removeEventListener("_internalStateChange", stateChangeListenerRef!);
      //The case where the conn is timeout, but the conn succeeds, this will leave a rouge conn
      //given a normal timeout of say 10sec it's higly unlike to happen
      if (con) {
        (con as WebSocket).removeEventListener("close", cleanupRejectRef!);
        (con as WebSocket).removeEventListener("error", cleanupRejectRef!);

        this.removeSocketEventListeners(con as WebSocket);

        (con as WebSocket).close();
      }

      throw error;
    }
  }

  private _buildUrl(data?: object) {
    if (this._options.url) {
      return this._options.url({
        params: data,
        retryInfo: {
          retryCount: this._retryCount,
          connectionRetryCount: this._connectionRetryCount,
          paramsRetryCount: this._paramsRetryCount,
        },
        url: this._url,
      });
    }

    let url = this._url;

    if (data) {
      url += `?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(data).filter(([_, v]) => v !== null && v !== undefined)
        )
      ).toString()}`;
    }

    return url;
  }

  private connection(data: object) {
    return this.transitionAsync({
      handler: this._connectSocket(this._buildUrl(data)),
      nextState: "connected",
      errorState: "connection_backoff",

      //! note - this can be triggered from closing the socket on the websocket.open callback, websocket.message, websocket.error, websoket.close
      staleSuccess: (socket) => {
        if (this._socket && this._socket === socket) {
          this._debug("removing stale socket");
          this._socket = null;
        }
        this.closeSocket(socket);
      },
    });
  }

  private connectionError(error: any) {
    this._connectionRetryCount++;

    const { maxRetries = DEFAULT.maxRetries } = this._options;

    if (error instanceof TimeoutError) this._debug("timeout error");

    //if the user threw a stop retry, we'll moved to failed
    if (error instanceof StopRetry) {
      this.transition("failed", error);
      return;
    }

    //max  retry reached
    if (this._retryCount >= maxRetries) {
      this.transition("failed", new StopRetry("max retry attempt reached"));
      return;
    }

    const timeout = setTimeout(() => {
      this.transition("auth");
    }, this._getNextDelay());

    return () => {
      clearTimeout(timeout);
    };
  }

  private clearBufferOnConnect() {
    for (let messageEvent of this._bufferedMessages)
      this.onSocketMessage(messageEvent, true);
    this._bufferedMessages = [];
  }

  private connected(_socket: WebSocket) {
    this._paramsRetryCount = 0;
    this._connectionRetryCount = 0;
    this._successCounter++;

    this.clearBufferOnConnect();

    const { heartbeatInterval } = this._options;
    let timeout: NodeJS.Timeout | undefined;

    if (typeof heartbeatInterval === "number") {
      timeout = setTimeout(() => {
        this.transition("ping");
      }, heartbeatInterval);
    }

    return () => {
      clearTimeout(timeout);
    };
  }

  private async heartbeat(con: WebSocket): Promise<void> {
    const {
      pingMessage = DEFAULT.pingMessage,
      pongMessage = DEFAULT.pongMessage,
      pingTimeout = DEFAULT.pingTimeout,
    } = this._options;

    //send the ping
    con.send(pingMessage);

    //await the pong
    return new Promise((res, rej) => {
      const timeout = setTimeout(() => {
        this._debug(`[warn] no pong recieved`);
        con.removeEventListener("message", messageHandler);
        rej();
      }, pingTimeout);

      const messageHandler = (e: MessageEvent) => {
        if (e.data === pongMessage) {
          clearTimeout(timeout);
          con.removeEventListener("message", messageHandler);
          res();
        }
      };

      con.addEventListener("message", messageHandler);
    });
  }

  private ping() {
    return this.transitionAsync({
      handler: this.heartbeat(this._socket!),
      nextState: "connected",
      errorState: "ping_backoff",
    });
  }

  private ping_backoff(): undefined {
    this._missedPingsCount++;
    const { maxMissedPingss = DEFAULT.maxMissedPings } = this._options;

    if (this._missedPingsCount >= maxMissedPingss) {
      this.transition("auth_backoff");
      return;
    }
    this.transition("ping");
  }

  private failed(data: any) {
    this.removeWindowEvents();
    this.dispatchEvent("disconnect", data);

    return () => {
      //when leaving the failed state reattach the event listeners
      this.attachWindowEvents();
    };
  }

  private closed(data: any) {
    this.removeWindowEvents();
    this.dispatchEvent("disconnect", data);
    return () => {
      //when leaving the failed state reattach the event listeners
      this.attachWindowEvents();
    };
  }

  private stopped() {
    this.removeWindowEvents();
    this.dispatchEvent("disconnect", undefined);
    this.removeEventListener("statusChange", this.handleLostConnection);
  }

  // for both lost connection. and slow inittial connection
  private handleLostConnection = (status: Status) => {
    const { lostConnectionTimeout = DEFAULT.lostConnectionTimeout } =
      this._options;

    if (status === "connected") {
      clearTimeout(this._lostConnection.lostConnectionTimeout);
      this._lostConnection.lostConnectionTimeout = undefined;
      if (this._lostConnection.didLoseConnection) {
        this._lostConnection.didLoseConnection = false;

        this.dispatchEvent("lostConnection", "restored");
      }
      return;
    }
    if (
      (status === "connecting" || status === "reconnecting") &&
      !this._lostConnection.lostConnectionTimeout
    ) {
      if (!this._lostConnection.didLoseConnection) {
        this._lostConnection.lostConnectionTimeout = setTimeout(() => {
          this._lostConnection.didLoseConnection = true;
          this._lostConnection.lostConnectionTimeout = undefined;

          this.dispatchEvent("lostConnection", "lost");
        }, lostConnectionTimeout);
      }
      return;
    }

    //todo maybe we want to add a new status 'closed'. since 'closed' is not necessarily 'failed' (semantically) :/
    if (status === "disconnected" || status === "closed") {
      clearTimeout(this._lostConnection.lostConnectionTimeout);
      this._lostConnection.lostConnectionTimeout = undefined;
      this._lostConnection.didLoseConnection = false;

      this.dispatchEvent("lostConnection", "failed");
      return;
    }
  };

  private attachWindowEvents() {
    const {
      ignoreFocusEvents = DEFAULT.ignoreFocusEvents,
      ignoreNetworkEvents = DEFAULT.ignoreNetworkEvents,
    } = this._options;

    if (typeof window !== "undefined") {
      if (!ignoreFocusEvents)
        window.addEventListener("focus", this.tryHeartbeat);

      if (!ignoreNetworkEvents) {
        window.addEventListener("online", this.tryHeartbeat);
        window.addEventListener("offline", this.tryHeartbeat);
      }
    }
  }

  private removeWindowEvents() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.tryHeartbeat);
      window.removeEventListener("offline", this.tryHeartbeat);
      window.removeEventListener("focus", this.tryHeartbeat);
    }
  }

  private tryHeartbeat = () => {
    this._debug(`[event] focus or offline or online`);

    if (!this.canTransition("ping")) {
      this._debug(`[invalid transition] ${this._state} -> ping`);
      return;
    }
    if (this.canTransition("ping")) this.transition("ping");
  };

  private buffer(msg: Message) {
    const { buffer } = this._options;

    if (buffer && typeof buffer === "boolean") {
      this._enqueuedMessages.push(msg);
    } else if (buffer) {
      if (this._enqueuedMessages.length < buffer.maxEnqueuedMessages)
        this._enqueuedMessages.push(msg);
    }
  }

  private _debug(...args: unknown[]) {
    if (this._options.debug) {
      this._debugLogger("RS>", ...args);
    }
  }

  private canTransition(target: State) {
    if (this._state === "stopped") return false;

    switch (target) {
      case "auth_backoff": {
        return this._state === "auth" || this._state === "ping_backoff";
      }

      case "connection": {
        return this._state === "auth";
      }

      case "connection_backoff": {
        return this._state === "connection";
      }

      case "connected": {
        return this._state === "connection" || this._state === "ping";
      }

      case "ping": {
        return (
          (this._state === "connected" || this._state === "ping_backoff") &&
          typeof this._options.heartbeatInterval === "number"
        );
      }
      case "ping_backoff": {
        return this._state === "ping";
      }

      case "auth":
      case "closed":
      case "failed":
      case "stopped":
        return true;

      default:
        return false;
    }
  }

  private doTransition(target: State, data?: any) {
    //cleanup the current async stuff

    while (this._cleanupFns.length > 0) {
      const fn = this._cleanupFns.pop();

      if (fn) fn();
    }

    this._debug(`[transition] `, this._state, " -> ", target);

    this._state = target;

    this.dispatchEvent("_internalStateChange", target); //here we are closing

    switch (target) {
      case "auth": {
        this._cleanupFns.push(this.authentication());
        break;
      }

      case "auth_backoff": {
        this._cleanupFns.push(this.authenticationError(data));
        break;
      }

      case "connection": {
        this._cleanupFns.push(this.connection(data));
        break;
      }

      case "connection_backoff": {
        this._cleanupFns.push(this.connectionError(data));
        break;
      }

      case "connected": {
        this._cleanupFns.push(this.connected(data));
        break;
      }

      case "ping": {
        this._cleanupFns.push(this.ping());
        break;
      }

      case "ping_backoff": {
        this._cleanupFns.push(this.ping_backoff());
        break;
      }

      case "failed": {
        this._cleanupFns.push(this.failed(data));
        break;
      }

      case "closed": {
        this._cleanupFns.push(this.closed(data));
        break;
      }

      case "stopped": {
        this.stopped();
        break;
      }
    }

    //get the current status
    let prevStatus = this._status;
    //get the updated status
    const newStatus = this.getStatus();
    //update the current status
    this._status = newStatus;

    //since we do not want to dispatch unnecessary status updates on every state transition. we'll only dispatch if the status actually changed
    if (prevStatus !== newStatus) this.dispatchEvent("statusChange", newStatus);
  }

  //useful for when we want to do cleanups when leaving certain states
  private cleanupCurrentState(target: State) {
    switch (this._state) {
      case "connected":
      case "ping":
      case "ping_backoff": {
        //when leaving the happy connected states to a non-connected state we cleanup the socket
        if (
          target !== "ping" &&
          target !== "connected" &&
          target !== "ping_backoff"
        ) {
          this._debug("closing websocket");
          this.closeSocket(this._socket!);
          this._socket = null;
        }

        break;
      }

      case "connection": {
        // if connectoin state has already set the socket. but now we've moved on to a non-connected state. we also cleanup the socket
        if (this._socket && target !== "connected") {
          this._debug("closing websocket");
          this.closeSocket(this._socket!);
          this._socket = null;
        }

        break;
      }
    }
  }

  private transition<T extends State>(target: T, data?: StateDataMap[T]) {
    if (!this.canTransition(target))
      throw new Error(`[invalid transition] ${this._state} -> ${target}`);

    this.cleanupCurrentState(target);
    this.doTransition(target, data);
  }

  private transitionAsync<T = any>({
    handler,
    nextState,
    errorState,
    staleSuccess,
  }: {
    handler: Promise<T>;
    nextState: State;
    errorState: State;
    staleSuccess?: (data: T) => void;
  }) {
    let stale: boolean = false;

    const transitionHandler = async () => {
      try {
        const data = await handler;

        if (stale) {
          if (typeof staleSuccess === "function") staleSuccess(data);
          return;
        }

        this.transition(nextState, data);
      } catch (error) {
        if (stale) return;

        this.transition(errorState, error);
      }
    };

    transitionHandler();

    return () => {
      stale = true;
    };
  }

  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  get lastMessageSent() {
    return this._lastMessageSent;
  }

  getStatus = (): Status => {
    switch (this._state) {
      case "auth":
      case "auth_backoff":
      // case "connection":
      case "connection_backoff":
        return this._successCounter > 0 ? "reconnecting" : "connecting";

      case "connection": {
        return this._socket
          ? "connected"
          : this._successCounter > 0
          ? "reconnecting"
          : "connecting";
      }

      case "connected":
      case "ping":
      case "ping_backoff": //'ping_backoff' is considered 'connected' as it will either move us to a connected or reconnecting state
        return "connected";

      case "stopped":
      case "failed":
        return "disconnected";

      case "initial":
      case "closed":
        return this._successCounter > 0 ? "closed" : "initial";

      default:
        throw new Error(`invalid state, this will never happen`, this._state);
    }
  };

  //todo semantically open should only work if the socket is closed. else it should throw an error. or noop. right now it works more closer to a 'reconnect' command semantically
  open() {
    this.transition("auth");
  }

  reconnect() {
    this.transition("auth");
  }

  close() {
    this.transition("closed");
  }

  stop() {
    this.transition("stopped");
  }

  isUsable() {
    return this._state !== "stopped";
  }

  canSend() {
    if (this._socket !== null && this._socket.readyState === 1) return true;
    return false;
  }

  //we're returning a boolean here, this'll help for custom enqueueing when offline
  send(data: Message) {
    if (this.canSend()) {
      this._socket!.send(data);
      this._lastMessageSent = Date.now();
      return true;
    }

    this.buffer(data);
    return false;
  }
}

type PublicResocket = Omit<
  ReSocket,
  "addEventListener" | "removeEventListener" | "dispatchEvent"
> &
  (new (
    url: string | URL,
    protocols?: string | string[] | undefined,
    options?: ReSocketOptions
  ) => PublicResocket) &
  CustomEventTarget<Omit<WebSocketEventMap, "_internalStateChange">>;

export type Socket = PublicResocket;
export const Socket = ReSocket as any as PublicResocket;
