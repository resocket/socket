import { ConnectionStatus } from "../components/ConnectionStatus";
import { LostConnectionToasts } from "../components/LostConnectionStatus";
import { SocketProvider } from "../resocket.config";

export default function Home() {
  return (
    <SocketProvider>
      <div
        style={{
          height: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ConnectionStatus />
        <LostConnectionToasts />
      </div>
    </SocketProvider>
  );
}
