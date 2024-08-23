import styles from "./ConnectionStatus.module.css";
import { useStatus } from "../resocket.config";

export const ConnectionStatus = () => {
  const status = useStatus();

  return (
    <div>
      <div className={styles.status} data-status={status}>
        <div className={styles.statusCircle} />
        <div className={styles.statusText}>{status}</div>
      </div>
    </div>
  );
};
