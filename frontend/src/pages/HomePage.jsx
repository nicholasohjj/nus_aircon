import { useState } from "react";
import { Card, Logo } from "../components/Card";
import styles from "./HomePage.module.css";

const HOSTEL_GROUPS = [
  {
    label: "PGPR, Houses @ PGP, Residential Colleges, NUS College",
    basePath: "",
    loadingPath: "/loading",
  },
  {
    label: "UTown Residence, RVRC",
    basePath: "/cp2nus",
    loadingPath: "/cp2nus/loading",
  },
];

function isValidMeterId(v) {
  return /^\d{8}$/.test(String(v || "").trim());
}

function isValidAmount(v) {
  const n = Number(String(v || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 6 && n <= 50;
}

export default function HomePage() {
  const [groupIndex, setGroupIndex] = useState(null);
  const [meterId, setMeterId] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState({});

  function validate() {
    const e = {};
    if (groupIndex === null) e.group = "Please select your hostel";
    if (!isValidMeterId(meterId)) e.meterId = "Must be exactly 8 digits";
    if (!isValidAmount(amount)) e.amount = "Between $6.00 and $50.00";
    return e;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    const group = HOSTEL_GROUPS[groupIndex];
    const qs = new URLSearchParams({
      txtMtrId: meterId.trim(),
      txtAmount: amount.trim(),
    }).toString();

    window.location.href = `${group.basePath}/webapp?${qs}`;
  }

  return (
    <Card align="left">
      <Logo>⚡</Logo>
      <h1 className={styles.title}>Electricity Top-Up</h1>
      <p className={styles.sub}>
        Enter your hostel and meter details to get started.
      </p>

      <form onSubmit={handleSubmit} autoComplete="off" noValidate>
        {/* ── Hostel group ── */}
        <div className={styles.field}>
          <label className={styles.label}>Hostel</label>
          <div className={styles.groupList}>
            {HOSTEL_GROUPS.map((g, i) => (
              <button
                key={i}
                type="button"
                className={[
                  styles.groupBtn,
                  groupIndex === i ? styles.groupBtnActive : "",
                ].join(" ")}
                onClick={() => {
                  setGroupIndex(i);
                  setErrors((p) => ({ ...p, group: undefined }));
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          {errors.group && <div className={styles.errMsg}>{errors.group}</div>}
        </div>

        {/* ── Meter ID ── */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="meterId">
            Meter ID
          </label>
          <input
            id="meterId"
            className={[
              styles.input,
              errors.meterId ? styles.inputError : "",
            ].join(" ")}
            type="tel"
            inputMode="numeric"
            maxLength={8}
            placeholder="8-digit meter ID"
            value={meterId}
            onChange={(e) => {
              setMeterId(e.target.value.replace(/\D/g, "").slice(0, 8));
              if (errors.meterId)
                setErrors((p) => ({ ...p, meterId: undefined }));
            }}
          />
          {errors.meterId && (
            <div className={styles.errMsg}>{errors.meterId}</div>
          )}
        </div>

        {/* ── Amount ── */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="amount">
            Amount (SGD)
          </label>
          <div className={styles.amountWrap}>
            <span className={styles.currency}>$</span>
            <input
              id="amount"
              className={[
                styles.input,
                styles.amountInput,
                errors.amount ? styles.inputError : "",
              ].join(" ")}
              type="number"
              inputMode="decimal"
              min="6"
              max="50"
              step="0.01"
              placeholder="6.00 – 50.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (errors.amount)
                  setErrors((p) => ({ ...p, amount: undefined }));
              }}
            />
          </div>
          {errors.amount && (
            <div className={styles.errMsg}>{errors.amount}</div>
          )}
        </div>

        {/* ── Presets ── */}
        <div className={styles.presets}>
          {[10, 20, 30, 50].map((v) => (
            <button
              key={v}
              type="button"
              className={[
                styles.preset,
                amount === String(v) ? styles.presetActive : "",
              ].join(" ")}
              onClick={() => {
                setAmount(String(v));
                setErrors((p) => ({ ...p, amount: undefined }));
              }}
            >
              ${v}
            </button>
          ))}
        </div>

        <button type="submit" className={styles.btn}>
          Continue →
        </button>

        <p className={styles.hint}>
          Payment is processed securely via eNETS. Your card details are
          RSA-encrypted before leaving your device.
        </p>
      </form>
    </Card>
  );
}
