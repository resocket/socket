# connection status + lost connection example

## acknowledgements

- this example is taken from [liveblocks example](https://github.com/liveblocks/liveblocks/tree/main/examples/nextjs-connection-status) & is implemented using @resocket/socket. which is also exposing similar (some differences) apis, as it's inspired form liveblocks api itself.

this is a connection status example, where we can see the live status of our socket connection. also we have the ability to show toast notifications in case we lose the connection it's all easily configurable. the connection is failed after 10 consecutive failed attempts. everything is easily configurable

```typescript src/resocket.config.ts
import { createSocketContext } from "@resocket/socket/react";

export const {
  SocketProvider, //provider for react
  useSocket, //get the instance of socket
  useStatus, //get the status of socket
  useLostConnectionListener, //for lost connection popup
} = createSocketContext({
  url: "ws://localhost:9000/server/fdd",
  options: {
    maxRetries: 5,

    //* [optional] sends a heartbeat every 30 seconds.
    heartbeatInterval: 30000,
  },
});
```
