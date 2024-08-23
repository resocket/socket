import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CloseEvent,
  ErrorEvent,
  LostConnectionStatus,
  Socket,
  SocketOptions,
  SocketStatus,
  StopRetry,
} from "./index";

type Listener<T = void> = (data: T) => void;

interface CreateSocketConfig {
  url: string;
  protocols?: string;
  options?: SocketOptions;
}

interface UseSocketOptions {
  onStatusChange?: Listener<SocketStatus>;
  onMessage?: Listener<MessageEvent<any>>;
  onDisconnect?: Listener<CloseEvent | ErrorEvent | StopRetry | undefined>;
  onLostConnection?: Listener<LostConnectionStatus>;
}

//* partyworks style factory function for react. we can create as many resocket instances as we want
export const createSocketContext = (config: CreateSocketConfig) => {
  const SocketContext = createContext<Socket | null>(null);

  let counter = 0;
  let inital = true;
  function SocketProvider(props: { children: React.ReactNode }) {
    const [socket] = useState(
      () =>
        new Socket(config.url, config.protocols, {
          ...config.options,
          startClosed: true, //we only connect on the client side
        })
    );

    useEffect(() => {
      counter++;

      if (inital && !config.options?.startClosed)
        (inital = false), socket.reconnect();

      return () => {
        counter--;

        if (counter < 1) {
          inital = true;
          socket.close();
        }
      };
    }, []);

    return (
      <SocketContext.Provider value={socket}>
        {props.children}
      </SocketContext.Provider>
    );
  }

  function useSocket(listeners?: UseSocketOptions) {
    const socket = useContext(SocketContext);
    const listenersRef = useRef(listeners);

    if (!socket || socket === null)
      throw new Error("accessing socket before initialization");

    useEffect(() => {
      listenersRef.current = listeners;
    }, [listeners]);

    useEffect(() => {
      const unsubs: Array<Listener> = [
        socket.on("message", (e) => {
          listenersRef.current?.onMessage?.(e);
        }),
        socket.on("status", (e) => {
          listenersRef.current?.onStatusChange?.(e);
        }),
        socket.on("disconnect", (e) => {
          listenersRef.current?.onDisconnect?.(e);
        }),
        socket.on("lostConnection", (e) => {
          listenersRef.current?.onLostConnection?.(e);
        }),
      ];

      return () => {
        unsubs.map((unsub) => unsub());
      };
    }, [socket]);

    return socket;
  }

  function useStatus() {
    const socket = useSocket();

    const snapshot = socket.getStatus;
    return useSyncExternalStore(
      (notify) => {
        return socket.on("status", notify);
      },
      snapshot,
      snapshot
    );
  }

  function useLostConnectionListener(callback: Listener<LostConnectionStatus>) {
    const socket = useSocket();
    const ref = useRef(callback);

    useEffect(() => {
      ref.current = callback;
    }, [callback]);

    useEffect(() => socket.on("lostConnection", ref.current), [socket]);
  }

  function useMessage(callback: Listener<MessageEvent<any>>) {
    const socket = useSocket();
    const ref = useRef(callback);

    useEffect(() => {
      ref.current = callback;
    }, [callback]);

    useEffect(() => socket.on("message", ref.current), [socket]);
  }

  return {
    SocketProvider,
    useSocket,
    useMessage,
    useStatus,
    useLostConnectionListener,
  };
};
