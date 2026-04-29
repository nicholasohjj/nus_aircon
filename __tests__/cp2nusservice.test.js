import { describe, test, expect } from "vitest";

const { parsePayResult } = require("../services/cp2nusService");

// ── Test fixtures ─────────────────────────────────────────────────────────────

// b2s redirects to /pay_result with all params base64-encoded
function makePayResultUrl(params) {
  const b64 = (v) => Buffer.from(String(v)).toString("base64");
  const url = new URL("https://enetspp-nus-live.evs.com.sg/pay_result");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, b64(v));
  }
  return url.toString();
}

const SUCCESS_URL = makePayResultUrl({
  r: "success",
  t: "12345678", // meterId
  a: "20.00", // amount
  x: "MTR-001", // txn reference
  s: "00", // stageRespCode
  m: "Payment completed.",
});

const FAILURE_URL = makePayResultUrl({
  r: "fail",
  t: "12345678",
  a: "20.00",
  x: "MTR-002",
  s: "05",
  m: "Transaction is rejected by financial institution.",
});

const PARTIAL_URL = makePayResultUrl({
  r: "success",
  t: "12345678",
  // a, x, s, m deliberately missing
});

// HTML fallback fixtures (used when URL parse fails)
const SUCCESS_HTML_SCRAPE = `
<html><body>
  <span class="success">Transaction successful</span>
  <p>Transaction Result <span>success</span></p>
  <p>Amount (SGD) <span>20.00</span></p>
  <p>Transaction Reference <span>MTR-HTML-001</span></p>
</body></html>
`;

const FAILURE_HTML_SCRAPE = `
<html><body>
  <span class="fail">Transaction failed</span>
  <p>Transaction Result <span>fail</span></p>
  <p>Transaction Message <span>Card declined.</span></p>
</body></html>
`;

// ── parsePayResult ────────────────────────────────────────────────────────────

describe("parsePayResult", () => {
  // ── URL path (base64 params) ──────────────────────────────────────────────

  test("returns status=success for r=success URL", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.status).toBe("success");
  });

  test("returns status=failure for r=fail URL", () => {
    const result = parsePayResult(FAILURE_URL, "");
    expect(result.status).toBe("failure");
  });

  test("decodes meterId (t param)", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.meterId).toBe("12345678");
  });

  test("decodes amount (a param) and formats it", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.amount).toContain("20.00");
  });

  test("decodes txnRef (x param)", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.merchantTxnRef).toBe("MTR-001");
  });

  test("decodes stageRespCode (s param)", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.stageRespCode).toBe("00");
  });

  test("sets reason to 'Payment completed.' on success", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.reason).toBe("Payment completed.");
  });

  test("sets reason to decoded m param on failure", () => {
    const result = parsePayResult(FAILURE_URL, "");
    expect(result.reason).toContain("rejected by financial institution");
  });

  test("handles missing optional params gracefully", () => {
    const result = parsePayResult(PARTIAL_URL, "");
    expect(result.status).toBe("success");
    expect(result.meterId).toBe("12345678");
    expect(result.merchantTxnRef).toBeNull();
    expect(result.amount).toBeNull(); // amtNum = 0, so returns null
  });

  test("returns failure status for r=fail regardless of m content", () => {
    const url = makePayResultUrl({
      r: "fail",
      t: "12345678",
      a: "20.00",
      x: "MTR-003",
      s: "99",
      m: "Unknown error",
    });
    const result = parsePayResult(url, "");
    expect(result.status).toBe("failure");
  });

  test("is case-insensitive for r=success check", () => {
    const url = makePayResultUrl({
      r: "SUCCESS",
      t: "12345678",
      a: "10.00",
      x: "REF",
      s: "00",
      m: "OK",
    });
    const result = parsePayResult(url, "");
    expect(result.status).toBe("success");
  });

  test("formats amount as 'S$ X.XX'", () => {
    const result = parsePayResult(SUCCESS_URL, "");
    expect(result.amount).toMatch(/^S\$ \d+\.\d{2}$/);
  });

  test("returns null amount when a param is 0 or missing", () => {
    const url = makePayResultUrl({
      r: "success",
      t: "12345678",
      a: "0",
      x: "X",
      s: "0",
      m: "ok",
    });
    const result = parsePayResult(url, "");
    expect(result.amount).toBeNull();
  });

  // ── HTML fallback path ────────────────────────────────────────────────────

  test("falls back to HTML scrape when URL is empty string", () => {
    const result = parsePayResult("", SUCCESS_HTML_SCRAPE);
    expect(result.status).toBe("success");
  });

  test("falls back to HTML scrape when URL is not a valid URL", () => {
    const result = parsePayResult("not-a-url", FAILURE_HTML_SCRAPE);
    expect(result.status).toBe("failure");
  });

  test("HTML fallback detects success via class=success element", () => {
    const result = parsePayResult("", SUCCESS_HTML_SCRAPE);
    expect(result.status).toBe("success");
  });

  test("HTML fallback detects failure via class=fail element", () => {
    const result = parsePayResult("", FAILURE_HTML_SCRAPE);
    expect(result.status).toBe("failure");
  });

  test("HTML fallback extracts txnRef from Transaction Reference span", () => {
    const result = parsePayResult("", SUCCESS_HTML_SCRAPE);
    expect(result.merchantTxnRef).toBe("MTR-HTML-001");
  });

  test("returns failure for completely empty inputs", () => {
    const result = parsePayResult("", "");
    expect(result.status).toBe("failure");
  });
});

// ── submitPanForm preParsed logic ─────────────────────────────────────────────
// We test the JSON parsing and netsTxnStatus branching logic in isolation,
// since submitPanForm itself makes an HTTP call.
// The preParsed logic lives in the returned object when message contains
// a parseable JSON with msg.netsTxnStatus.

describe("submitPanForm preParsed branching (unit)", () => {
  // Simulate what submitPanForm does internally with the message field
  function parseMessagePreParsed(message) {
    try {
      const msgObj = JSON.parse(decodeURIComponent(message));
      const status = msgObj?.msg?.netsTxnStatus;
      const msg = msgObj?.msg || {};

      if (status === "1" || msgObj?.ss === "0") {
        return {
          status: "failure",
          merchantTxnRef: msg.merchantTxnRef || null,
          meterId: null,
          amount: null,
          stageRespCode: msg.stageRespCode || null,
          reason: (msg.netsTxnMsg || "Payment declined.").replace(/\+/g, " "),
        };
      } else if (status === "0") {
        const amtDeducted = msg.netsAmountDeducted;
        const amtFormatted =
          amtDeducted > 0 ? `S$ ${(amtDeducted / 100).toFixed(2)}` : null;
        return {
          status: "success",
          merchantTxnRef: msg.merchantTxnRef || null,
          meterId: null,
          amount: amtFormatted,
          stageRespCode: msg.stageRespCode || null,
          reason: "Payment completed.",
        };
      }
      return null; // unrecognised status — fall through to b2s
    } catch {
      return null;
    }
  }

  const makeMessage = (overrides) =>
    encodeURIComponent(
      JSON.stringify({
        msg: {
          netsTxnStatus: "0",
          merchantTxnRef: "MTR-001",
          netsAmountDeducted: 2000,
          stageRespCode: "00",
          netsTxnMsg: "Approved",
          ...overrides,
        },
      }),
    );

  test("netsTxnStatus=0 resolves to success", () => {
    const result = parseMessagePreParsed(makeMessage({ netsTxnStatus: "0" }));
    expect(result).not.toBeNull();
    expect(result.status).toBe("success");
  });

  test("netsTxnStatus=1 resolves to failure", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "1", netsTxnMsg: "Declined" }),
    );
    expect(result).not.toBeNull();
    expect(result.status).toBe("failure");
    expect(result.reason).toBe("Declined");
  });

  test("ss=0 at top level resolves to failure", () => {
    const message = encodeURIComponent(
      JSON.stringify({
        ss: "0",
        msg: {
          netsTxnStatus: "1",
          merchantTxnRef: "MTR-SS",
          netsTxnMsg: "Rejected",
          stageRespCode: "05",
        },
      }),
    );
    const result = parseMessagePreParsed(message);
    expect(result.status).toBe("failure");
  });

  test("netsAmountDeducted converts cents to SGD correctly", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "0", netsAmountDeducted: 2000 }),
    );
    expect(result.amount).toBe("S$ 20.00");
  });

  test("netsAmountDeducted=0 returns null amount", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "0", netsAmountDeducted: 0 }),
    );
    expect(result.amount).toBeNull();
  });

  test("replaces + with space in netsTxnMsg", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "1", netsTxnMsg: "Card+declined+by+bank" }),
    );
    expect(result.reason).toBe("Card declined by bank");
  });

  test("defaults to 'Payment declined.' when netsTxnMsg is missing", () => {
    const message = encodeURIComponent(
      JSON.stringify({ msg: { netsTxnStatus: "1", merchantTxnRef: "X" } }),
    );
    const result = parseMessagePreParsed(message);
    expect(result.reason).toBe("Payment declined.");
  });

  test("returns null (fall through to b2s) when netsTxnStatus is unrecognised", () => {
    const result = parseMessagePreParsed(makeMessage({ netsTxnStatus: "99" }));
    expect(result).toBeNull();
  });

  test("returns null when message is not valid JSON", () => {
    const result = parseMessagePreParsed("not-json");
    expect(result).toBeNull();
  });

  test("returns null when message is empty", () => {
    const result = parseMessagePreParsed("");
    expect(result).toBeNull();
  });

  test("preserves merchantTxnRef on success", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "0", merchantTxnRef: "MYREF" }),
    );
    expect(result.merchantTxnRef).toBe("MYREF");
  });

  test("preserves merchantTxnRef on failure", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "1", merchantTxnRef: "FAILREF" }),
    );
    expect(result.merchantTxnRef).toBe("FAILREF");
  });

  test("preserves stageRespCode on success", () => {
    const result = parseMessagePreParsed(
      makeMessage({ netsTxnStatus: "0", stageRespCode: "00" }),
    );
    expect(result.stageRespCode).toBe("00");
  });

  test("meterId is always null (set by outer handler, not preParsed)", () => {
    const result = parseMessagePreParsed(makeMessage({ netsTxnStatus: "0" }));
    expect(result.meterId).toBeNull();
  });
});
