import { createSocketContext } from "@resocket/socket/react";

export const {
  SocketProvider,
  useMessage,
  useSocket,
  useStatus,
  useLostConnectionListener,
} = createSocketContext({
  url: "ws://localhost:9000/server/fdd",
  options: {
    maxRetries: 5,

    //* [optional] sends a heartbeat every 30 seconds.
    heartbeatInterval: 30000,
  },
});
