import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import styles from "./ResultPage.module.css";

function useTelegram() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);
}

// ── Small presentational pieces ───────────────────────────────────────────────

function DetailRow({ label, value }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResultPage({ basePath = "" }) {
  useTelegram();

  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const initialErr = token ? null : "Missing result token.";

  const [session, setSession] = useState(null);
  const [loadErr, setLoadErr] = useState(initialErr);

  // ── Fetch session ───────────────────────────────────────────────────────────
  // All result data lives server-side in the session — we never trust query
  // params for the outcome (avoids result-page tampering).
  useEffect(() => {
    if (!token) return;

    fetch(`${basePath}/webapp/session?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!data.ok) throw new Error(data.error || "Session not found.");
        return data;
      })
      .then(setSession)
      .catch((err) => setLoadErr(err.message));
  }, [token, basePath]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function sendNotify() {
    try {
      await fetch(`${basePath}/webapp/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      // best-effort — don't block navigation on notify failure
    }
  }

  async function handleClose() {
    await sendNotify();
    window.Telegram?.WebApp?.close();
  }

  async function handleTopUpAgain() {
    await sendNotify();
    const meterId = session?.txtMtrId || "";
    const amount = String(session?.txtAmount || "").replace(/[^0-9.]/g, "");
    window.location.href =
      `${basePath}/webapp?txtMtrId=${encodeURIComponent(meterId)}` +
      `&txtAmount=${encodeURIComponent(amount)}`;
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (!session && !loadErr) {
    return (
      <div className={styles.centred}>
        <div className={styles.spinner} />
      </div>
    );
  }

  // ── Session error ───────────────────────────────────────────────────────────
  if (loadErr) {
    return (
      <div className={styles.card}>
        <div className={[styles.logo, styles.logoFail].join(" ")}>⚠️</div>
        <h1 className={styles.title}>Session Expired</h1>
        <p className={styles.subtitle}>
          {loadErr} Check your meter balance to confirm whether the payment went
          through.
        </p>
      </div>
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  const ok = session.status === "success";
  const title = ok ? "Top-Up Successful" : "Top-Up Failed";
  const subtitle = ok
    ? "Your transaction has been processed."
    : "Your transaction was not completed.";
  const reason = session.reason;

  const balanceDisplay =
    session.balance !== undefined &&
    session.balance !== null &&
    session.balance !== ""
      ? `SGD ${Number(session.balance).toFixed(2)}`
      : null;

  const amountDisplay =
    session.txtAmount !== undefined &&
    session.txtAmount !== null &&
    session.txtAmount !== ""
      ? `SGD ${Number(String(session.txtAmount).replace(/[^0-9.]/g, "")).toFixed(2)}`
      : null;

  return (
    <div className={styles.card}>
      <div
        className={[styles.logo, ok ? styles.logoOk : styles.logoFail].join(
          " ",
        )}
      >
        {ok ? "✅" : "⚠️"}
      </div>

      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>

      <div className={styles.details}>
        <DetailRow label="Reference" value={session.merchantTxnRef || "—"} />
        <DetailRow label="Meter ID" value={session.txtMtrId || "—"} />
        {session.address && (
          <DetailRow label="Address" value={session.address} />
        )}
        {balanceDisplay && <DetailRow label="Balance" value={balanceDisplay} />}
        {amountDisplay && <DetailRow label="Amount" value={amountDisplay} />}
      </div>

      <div
        className={[
          styles.statusNote,
          ok ? styles.noteOk : styles.noteFail,
        ].join(" ")}
      >
        {reason}
      </div>

      <div className={styles.actions}>
        <button
          className={[
            styles.btn,
            ok ? styles.btnPrimary : styles.btnSecondary,
          ].join(" ")}
          onClick={handleTopUpAgain}
        >
          Top Up Again
        </button>
        <button
          className={[styles.btn, styles.btnSecondary].join(" ")}
          onClick={handleClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
