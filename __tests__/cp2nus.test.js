import { describe, test, expect } from "vitest";

const {
  buildPayDisplayAddress,
  buildEnetsPayUrl,
} = require("../services/cp2nusService");

const {
  errorPage,
  loadingPage,
  cardPaymentPage,
  renderFinalResultPage,
} = require("../views/cp2nus");

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FULL_METER_INFO = {
  premise: {
    block: "12",
    level: "03",
    unit: "45",
    building: "Sheares Hall",
  },
  address: "Block 12, 03-45 Sheares Hall, University Road, Singapore 119076",
  credit_bal: 18.5,
};

const MINIMAL_METER_INFO = {
  premise: { block: "5", level: "02", unit: "10", building: "" },
  address: "Block 5, 02-10, Some Road, Singapore 123456",
};

const BASE_PATH = "/cp2nus";

// ── buildPayDisplayAddress ────────────────────────────────────────────────────

describe("buildPayDisplayAddress", () => {
  test("formats a full meter info object correctly", () => {
    const result = buildPayDisplayAddress(FULL_METER_INFO);
    expect(result).toContain("12");
    expect(result).toContain("03-45");
    expect(result).toContain("Sheares Hall");
  });

  test("returns empty string for null input", () => {
    expect(buildPayDisplayAddress(null)).toBe("");
  });

  test("returns empty string for undefined input", () => {
    expect(buildPayDisplayAddress(undefined)).toBe("");
  });

  test("handles missing premise fields gracefully", () => {
    const result = buildPayDisplayAddress({
      premise: {},
      address: "Some Address",
    });
    expect(typeof result).toBe("string");
  });

  test("handles missing premise object entirely", () => {
    const result = buildPayDisplayAddress({ address: "Fallback Address" });
    expect(typeof result).toBe("string");
  });

  test("strips the redundant Block prefix from address tail", () => {
    const result = buildPayDisplayAddress(FULL_METER_INFO);
    // Should not have "Block 12, 03-45 Sheares Hall, Block 12..." duplication
    const blockCount = (result.match(/Block 12/g) || []).length;
    expect(blockCount).toBeLessThanOrEqual(1);
  });

  test("handles empty building name", () => {
    const result = buildPayDisplayAddress(MINIMAL_METER_INFO);
    expect(result).toContain("5");
    expect(result).toContain("02-10");
  });

  test("trims whitespace from output", () => {
    const result = buildPayDisplayAddress(FULL_METER_INFO);
    expect(result).toBe(result.trim());
  });
});

// ── buildEnetsPayUrl ──────────────────────────────────────────────────────────

describe("buildEnetsPayUrl", () => {
  const BASE_ARGS = {
    req: "test-req-token",
    sign: "test-sign-token",
    username: "12345678",
    amount: 20,
    address: "Blk 12, 03-45 Sheares Hall",
  };

  test("returns a URL string", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^https?:\/\//);
  });

  test("contains a base64-encoded p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    expect(p).toBeTruthy();
    // Should be valid base64
    expect(() => Buffer.from(p, "base64").toString("utf8")).not.toThrow();
  });

  test("encodes req and sign into the p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    expect(inner).toContain("test-req-token");
    expect(inner).toContain("test-sign-token");
  });

  test("encodes username into the p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    // m= is base64 of username
    const mMatch = inner.match(/m=([^&]+)/);
    expect(mMatch).toBeTruthy();
    expect(Buffer.from(mMatch[1], "base64").toString("utf8")).toBe("12345678");
  });

  test("formats amount to 2 decimal places", () => {
    const url = buildEnetsPayUrl({ ...BASE_ARGS, amount: 6 });
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    // a= is base64 of "6.00"
    const aMatch = inner.match(/a=([^&]+)/);
    expect(aMatch).toBeTruthy();
    expect(Buffer.from(aMatch[1], "base64").toString("utf8")).toBe("6.00");
  });

  test("encodes address into the p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    const dMatch = inner.match(/d=([^&]+)/);
    expect(dMatch).toBeTruthy();
    expect(Buffer.from(dMatch[1], "base64").toString("utf8")).toBe(
      "Blk 12, 03-45 Sheares Hall",
    );
  });

  test("handles empty address", () => {
    const url = buildEnetsPayUrl({ ...BASE_ARGS, address: "" });
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^https?:\/\//);
  });

  test("produces different URLs for different amounts", () => {
    const url1 = buildEnetsPayUrl({ ...BASE_ARGS, amount: 10 });
    const url2 = buildEnetsPayUrl({ ...BASE_ARGS, amount: 20 });
    expect(url1).not.toBe(url2);
  });

  test("produces different URLs for different usernames", () => {
    const url1 = buildEnetsPayUrl({ ...BASE_ARGS, username: "11111111" });
    const url2 = buildEnetsPayUrl({ ...BASE_ARGS, username: "22222222" });
    expect(url1).not.toBe(url2);
  });
});

// ── errorPage ─────────────────────────────────────────────────────────────────

describe("errorPage", () => {
  test("returns an HTML string", () => {
    const html = errorPage("Something went wrong");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Something went wrong");
  });

  test("escapes HTML in the message", () => {
    const html = errorPage('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes ampersands", () => {
    const html = errorPage("Error: foo & bar");
    expect(html).toContain("foo &amp; bar");
  });

  test("handles empty message", () => {
    const html = errorPage("");
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ── loadingPage ───────────────────────────────────────────────────────────────

describe("loadingPage", () => {
  test("renders meter ID", () => {
    const html = loadingPage("12345678", "20", {}, BASE_PATH);
    expect(html).toContain("12345678");
  });

  test("renders formatted amount", () => {
    const html = loadingPage("12345678", "20", {}, BASE_PATH);
    expect(html).toContain("20.00");
  });

  test("renders address when present in meterInfo", () => {
    const html = loadingPage(
      "12345678",
      "20",
      { address: "Blk 12, 03-45 Sheares Hall" },
      BASE_PATH,
    );
    expect(html).toContain("Blk 12, 03-45 Sheares Hall");
  });

  test("omits address row when address is absent", () => {
    const html = loadingPage("12345678", "20", {}, BASE_PATH);
    expect(html).not.toContain('detail-label">Address');
  });

  test("renders balance when present", () => {
    const html = loadingPage("12345678", "20", { credit_bal: 18.5 }, BASE_PATH);
    expect(html).toContain("18.50");
  });

  test("omits balance row when credit_bal is absent", () => {
    const html = loadingPage("12345678", "20", {}, BASE_PATH);
    expect(html).not.toContain("Current Balance");
  });

  test("uses basePath in bootstrap fetch URL", () => {
    const html = loadingPage("12345678", "20", {}, "/mybase");
    expect(html).toContain("/mybase/webapp/bootstrap");
  });

  test("escapes meter ID to prevent XSS", () => {
    const html = loadingPage(
      "<img src=x onerror=alert(1)>",
      "20",
      {},
      BASE_PATH,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  test("handles zero credit_bal (falsy but valid)", () => {
    const html = loadingPage("12345678", "20", { credit_bal: 0 }, BASE_PATH);
    expect(html).toContain("0.00");
  });
});

// ── cardPaymentPage ───────────────────────────────────────────────────────────

describe("cardPaymentPage", () => {
  const BASE_CARD_ARGS = {
    n: "rsa-modulus-abc",
    e: "010001",
    netsMid: "807574000",
    netsTxnRef: "TXN20250428",
    merchantTxnRef: "MTR-001",
    amount: "20",
    meterId: "12345678",
    address: "Blk 12, 03-45 Sheares Hall",
    balance: "18.50",
    txnRand: "rand-token-xyz",
    keyId: "key-id-abc",
    hmac: "hmac-value-abc",
    basePath: BASE_PATH,
  };

  test("renders meter ID in summary", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("12345678");
  });

  test("renders formatted amount", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("20.00");
  });

  test("injects RSA modulus as JS constant", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("rsa-modulus-abc");
  });

  test("injects netsMid into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="807574000"');
  });

  test("injects netsTxnRef into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="TXN20250428"');
  });

  test("injects txnRand into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="rand-token-xyz"');
  });

  test("injects keyId into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="key-id-abc"');
  });

  test("injects hmac into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="hmac-value-abc"');
  });

  test("uses basePath in enets_pay fetch URL", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain(`${BASE_PATH}/webapp/enets_pay`);
  });

  test("uses basePath in result redirect", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain(`${BASE_PATH}/webapp/result`);
  });

  test("escapes netsMid to prevent attribute injection", () => {
    const html = cardPaymentPage({
      ...BASE_CARD_ARGS,
      netsMid: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("loads RSA JS libraries from enets.sg", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("https://www.enets.sg/GW2/js/rsa.js");
  });

  test("includes card number input field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('id="cardNo"');
  });

  test("includes CVV input field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('id="cvv"');
  });

  test("handles default empty optional fields", () => {
    const html = cardPaymentPage({
      ...BASE_CARD_ARGS,
      txnRand: "",
      keyId: "",
      hmac: "",
      address: "",
      balance: "",
    });
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ── renderFinalResultPage ─────────────────────────────────────────────────────

describe("renderFinalResultPage", () => {
  const SUCCESS_PARSED = {
    status: "success",
    merchantTxnRef: "MTR-001",
    meterId: "12345678",
    amount: "S$ 20.00",
    reason: "Payment completed.",
    address: "Blk 12, 03-45 Sheares Hall",
    balance: "18.50",
  };

  const FAILURE_PARSED = {
    status: "failure",
    merchantTxnRef: "MTR-002",
    meterId: "12345678",
    amount: "S$ 20.00",
    reason: "Transaction is rejected by financial institution.",
    address: "",
    balance: "",
  };

  test("renders success title on success", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("Top-Up Successful");
  });

  test("renders failure title on failure", () => {
    const html = renderFinalResultPage(FAILURE_PARSED, BASE_PATH);
    expect(html).toContain("Top-Up Failed");
  });

  test("renders merchant txn ref", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("MTR-001");
  });

  test("renders meter ID", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("12345678");
  });

  test("renders amount", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("S$ 20.00");
  });

  test("renders reason text", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("Payment completed.");
  });

  test("renders failure reason text", () => {
    const html = renderFinalResultPage(FAILURE_PARSED, BASE_PATH);
    expect(html).toContain("Transaction is rejected by financial institution.");
  });

  test("renders address when present", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("Blk 12, 03-45 Sheares Hall");
  });

  test("omits address row when address is empty", () => {
    const html = renderFinalResultPage(FAILURE_PARSED, BASE_PATH);
    expect(html).not.toContain('detail-label">Address');
  });

  test("renders balance when present", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    expect(html).toContain("18.50");
  });

  test("omits balance row when balance is empty string", () => {
    const html = renderFinalResultPage(FAILURE_PARSED, BASE_PATH);
    expect(html).not.toContain('detail-label">Balance');
  });

  test("Top Up Again button uses safe URL with escHtml-wrapped basePath", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    // The button href should contain the basePath and encoded meter ID
    expect(html).toContain(`${BASE_PATH}/webapp`);
    expect(html).toContain(encodeURIComponent("12345678"));
  });

  test("Top Up Again button URL-encodes the meter ID", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, meterId: "12345678" },
      BASE_PATH,
    );
    expect(html).toContain(encodeURIComponent("12345678"));
  });

  test("Top Up Again button strips non-numeric chars from amount for URL", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, BASE_PATH);
    // "S$ 20.00" → "20.00" after replace(/[^0-9.]/g, "")
    expect(html).toContain(encodeURIComponent("20.00"));
  });

  test("escapes reason to prevent XSS", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, reason: '<script>alert("xss")</script>' },
      BASE_PATH,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes merchantTxnRef to prevent XSS", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, merchantTxnRef: '<b onmouseover="evil()">ref</b>' },
      BASE_PATH,
    );
    expect(html).not.toContain("<b onmouseover");
    expect(html).toContain("&lt;b");
  });

  test("renders dash when merchantTxnRef is missing", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, merchantTxnRef: null },
      BASE_PATH,
    );
    expect(html).toContain(">-<");
  });

  test("renders dash when meterId is missing", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, meterId: null },
      BASE_PATH,
    );
    expect(html).toContain(">-<");
  });

  test("renders dash when amount is missing", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, amount: null },
      BASE_PATH,
    );
    expect(html).toContain(">-<");
  });

  test("uses default reason when reason is falsy", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, reason: "" },
      BASE_PATH,
    );
    expect(html).toContain("Unable to determine transaction outcome.");
  });

  test("uses basePath in Top Up Again href", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED, "/custom");
    expect(html).toContain("/custom/webapp");
  });

  test("omits balance row when balance is null", () => {
    const html = renderFinalResultPage(
      { ...SUCCESS_PARSED, balance: null },
      BASE_PATH,
    );
    expect(html).not.toContain('detail-label">Balance');
  });

  test("omits balance row when balance is undefined", () => {
    const { balance: _b, ...rest } = SUCCESS_PARSED;
    const html = renderFinalResultPage(rest, BASE_PATH);
    expect(html).not.toContain('detail-label">Balance');
  });
});
