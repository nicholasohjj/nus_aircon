import styles from "./ErrorCard.module.css";

export default function ErrorCard({ message, onRetry }) {
  if (!message) return null;

  return (
    <>
      <div className={styles.errorCard}>
        <strong>⚠️ Unable to continue</strong>
        <br />
        {message}
      </div>
      {onRetry && (
        <button className={styles.retryBtn} onClick={onRetry}>
          Try Again
        </button>
      )}
    </>
  );
}
