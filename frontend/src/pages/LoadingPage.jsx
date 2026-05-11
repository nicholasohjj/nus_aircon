import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, DetailRow, Logo } from "../components/Card";
import styles from "./LoadingPage.module.css";

// Telegram Mini App hook
function useTelegram() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);
}

const STAGE_LABELS = {
  init: "Starting secure session…",
  evs_home: "Connecting to EVS…",
  login: "Authenticating meter…",
  select_offer: "Selecting package…",
  payment_servlet: "Preparing payment…",
  creditpayment: "Creating eNETS payment request…",
  enets_paymentlistener: "Opening payment gateway…",
};

export default function LoadingPage({ basePath = "" }) {
  useTelegram();

  // Pull params from the query string — server still drives navigation to this page
  const [searchParams] = useSearchParams();
  const meterId = searchParams.get("txtMtrId") || "";
  const amount = searchParams.get("txtAmount") || "";
  const chatId = searchParams.get("chatId") || "";
  const address = searchParams.get("address") || null;
  const balance = searchParams.get("balance") || null;

  const amtDisplay = Number(amount).toFixed(2);
  const balDisplay =
    balance !== null && balance !== "" ? Number(balance).toFixed(2) : null;

  const [statusText, setStatusText] = useState("Initialising…");
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(true);
  const abortRef = useRef(null);

  const runFlow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setRunning(true);
    setStatusText("Initialising…");

    try {
      setStatusText(STAGE_LABELS.evs_home);

      const url =
        `${basePath}/webapp/bootstrap` +
        `?txtMtrId=${encodeURIComponent(meterId)}` +
        `&txtAmount=${encodeURIComponent(amount)}` +
        `&chatId=${encodeURIComponent(chatId)}`;

      const resp = await fetch(url, { signal: abortRef.current.signal });
      const out = await resp.json().catch(() => ({}));

      if (!resp.ok || !out.ok) {
        const stage = out.stage || "init";
        setStatusText(STAGE_LABELS[stage] || "Failed");
        throw new Error(out.error || "Failed to initialise payment flow");
      }

      if (!out.redirectUrl) throw new Error("Missing redirect URL");

      setStatusText(
        STAGE_LABELS[out.stage] || STAGE_LABELS.enets_paymentlistener,
      );
      window.location.href = out.redirectUrl;
    } catch (err) {
      if (err.name === "AbortError") return;
      setRunning(false);
      setError(err.message || "Something went wrong. Please try again.");
    }
  }, [basePath, meterId, amount, chatId]);

  useEffect(() => {
    runFlow();
    return () => abortRef.current?.abort();
  }, [runFlow]);

  return (
    <Card align="center">
      <Logo>⚡</Logo>
      <h1 className={styles.title}>Electricity Top-Up</h1>
      <p className={styles.subtitle}>
        Connecting to EVS{basePath ? " (cp2nus)" : " (cp2)"} payment gateway…
      </p>

      <DetailRow label="Meter ID" value={meterId} />
      {address && <DetailRow label="Address" value={address} />}
      {balDisplay !== null && (
        <DetailRow label="Current Balance" value={`SGD ${balDisplay}`} />
      )}
      <DetailRow label="Amount" value={`SGD ${amtDisplay}`} />

      {running && (
        <div className={styles.spinnerWrap}>
          <div className={styles.spinner} />
          <div className={styles.statusText}>{statusText}</div>
        </div>
      )}

      {error && (
        <>
          <div className={styles.errorCard}>
            <strong>⚠️ Unable to continue</strong>
            <br />
            {error}
          </div>
          <button className={styles.retryBtn} onClick={runFlow}>
            Try Again
          </button>
        </>
      )}
    </Card>
  );
}
