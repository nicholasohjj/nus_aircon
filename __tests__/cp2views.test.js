import { describe, test, expect } from "vitest";

const {
  errorPage,
  loadingPage,
  cardPaymentPage,
  renderFinalResultPage,
} = require("../views/cp2");

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BASE_CARD_ARGS = {
  n: "rsa-modulus-abc",
  e: "010001",
  netsMid: "UMID_807572000",
  netsTxnRef: "TXN20250428",
  merchantTxnRef: "MTR-001",
  amount: "20",
  meterId: "12345678",
  address: "Blk 12, 03-45 Sheares Hall",
  balance: "18.50",
  actionUrl: "https://www.enets.sg/enets2/PaymentListener.do",
};

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

// ── errorPage ─────────────────────────────────────────────────────────────────

describe("errorPage (cp2)", () => {
  test("returns an HTML string containing the message", () => {
    const html = errorPage("Something went wrong");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Something went wrong");
  });

  test("escapes HTML tags in the message", () => {
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

describe("loadingPage (cp2)", () => {
  test("renders meter ID", () => {
    const html = loadingPage("12345678", "20");
    expect(html).toContain("12345678");
  });

  test("renders formatted amount", () => {
    const html = loadingPage("12345678", "20");
    expect(html).toContain("20.00");
  });

  test("renders address when present in meterInfo", () => {
    const html = loadingPage("12345678", "20", {
      address: "Blk 12, 03-45 Sheares Hall",
    });
    expect(html).toContain("Blk 12, 03-45 Sheares Hall");
  });

  test("omits address row when address is absent", () => {
    const html = loadingPage("12345678", "20", {});
    expect(html).not.toContain('detail-label">Address');
  });

  test("renders balance when credit_bal is present", () => {
    const html = loadingPage("12345678", "20", { credit_bal: 18.5 });
    expect(html).toContain("18.50");
  });

  test("omits balance row when credit_bal is absent", () => {
    const html = loadingPage("12345678", "20", {});
    expect(html).not.toContain("Current Balance");
  });

  test("handles zero credit_bal (falsy but valid)", () => {
    const html = loadingPage("12345678", "20", { credit_bal: 0 });
    expect(html).toContain("0.00");
  });

  test("calls /webapp/bootstrap (no basePath prefix for cp2)", () => {
    const html = loadingPage("12345678", "20");
    expect(html).toContain("/webapp/bootstrap");
  });

  test("escapes meter ID to prevent XSS", () => {
    const html = loadingPage("<img src=x onerror=alert(1)>", "20");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  test("contains spinner and status text elements", () => {
    const html = loadingPage("12345678", "20");
    expect(html).toContain('id="spinnerWrap"');
    expect(html).toContain('id="statusText"');
  });

  test("contains retry button", () => {
    const html = loadingPage("12345678", "20");
    expect(html).toContain('id="retryBtn"');
  });

  test("subtitle mentions cp2 gateway", () => {
    const html = loadingPage("12345678", "20");
    expect(html.toLowerCase()).toContain("cp2");
  });
});

// ── cardPaymentPage ───────────────────────────────────────────────────────────

describe("cardPaymentPage (cp2)", () => {
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

  test("injects RSA exponent as JS constant", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("010001");
  });

  test("injects netsMid into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="UMID_807572000"');
  });

  test("injects netsTxnRef into hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('value="TXN20250428"');
  });

  test("does NOT include txnRand hidden field (cp2 difference from cp2nus)", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).not.toContain('name="txnRand"');
  });

  test("does NOT include keyId hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).not.toContain('name="keyId"');
  });

  test("does NOT include hmac hidden field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).not.toContain('name="hmac"');
  });

  test("posts to /webapp/enets_pay", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("/webapp/enets_pay");
  });

  test("redirects to /webapp/result on success", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("/webapp/result");
  });

  test("loads RSA JS libraries from enets.sg", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("https://www.enets.sg/GW2/js/rsa.js");
    expect(html).toContain("https://www.enets.sg/GW2/js/jsbn.js");
  });

  test("includes linebrk function for RSA chunking", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("linebrk");
  });

  test("includes card number input field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('id="cardNo"');
  });

  test("includes CVV input field", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('id="cvv"');
  });

  test("includes cardholder name and email fields", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('id="cardName"');
    expect(html).toContain('id="cardEmail"');
  });

  test("includes expiry month and year fields", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('id="expMth"');
    expect(html).toContain('id="expYr"');
  });

  test("sends currencyCode SGD in payload", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain("SGD");
  });

  test("converts amount to cents in payload (txnAmount)", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    // 20 * 100 = 2000
    expect(html).toContain("Math.round");
  });

  test("passes meterId and address in fetch payload", () => {
    const html = cardPaymentPage(BASE_CARD_ARGS);
    expect(html).toContain('"meterId"');
    expect(html).toContain('"address"');
  });

  test("escapes netsMid to prevent attribute injection", () => {
    const html = cardPaymentPage({
      ...BASE_CARD_ARGS,
      netsMid: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("handles empty address and balance", () => {
    const html = cardPaymentPage({
      ...BASE_CARD_ARGS,
      address: "",
      balance: "",
    });
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ── renderFinalResultPage ─────────────────────────────────────────────────────

describe("renderFinalResultPage (cp2)", () => {
  test("renders success title on success", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("Top-Up Successful");
  });

  test("renders failure title on failure", () => {
    const html = renderFinalResultPage(FAILURE_PARSED);
    expect(html).toContain("Top-Up Failed");
  });

  test("renders merchant txn ref", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("MTR-001");
  });

  test("renders meter ID", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("12345678");
  });

  test("renders amount", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("SGD 20.00");
  });

  test("renders reason text", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("Payment completed.");
  });

  test("renders failure reason text", () => {
    const html = renderFinalResultPage(FAILURE_PARSED);
    expect(html).toContain("Transaction is rejected by financial institution.");
  });

  test("renders address when present", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("Blk 12, 03-45 Sheares Hall");
  });

  test("omits address row when address is empty", () => {
    const html = renderFinalResultPage(FAILURE_PARSED);
    expect(html).not.toContain('detail-label">Address');
  });

  test("renders balance when present", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("18.50");
  });

  test("omits balance row when balance is empty string", () => {
    const html = renderFinalResultPage(FAILURE_PARSED);
    expect(html).not.toContain('detail-label">Balance');
  });

  test("omits balance row when balance is null", () => {
    const html = renderFinalResultPage({ ...SUCCESS_PARSED, balance: null });
    expect(html).not.toContain('detail-label">Balance');
  });

  test("omits balance row when balance is undefined", () => {
    const { balance: _b, ...rest } = SUCCESS_PARSED;
    const html = renderFinalResultPage(rest);
    expect(html).not.toContain('detail-label">Balance');
  });

  test("Top Up Again button links to /webapp with encoded params", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("/webapp?txtMtrId=");
    expect(html).toContain(encodeURIComponent("12345678"));
  });

  test("Top Up Again button strips non-numeric chars from amount for URL", () => {
    // "S$ 20.00" → "20.00" after replace(/[^0-9.]/g, "")
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain(encodeURIComponent("20.00"));
  });

  test("uses default reason when reason is falsy", () => {
    const html = renderFinalResultPage({ ...SUCCESS_PARSED, reason: "" });
    expect(html).toContain("Unable to determine transaction outcome.");
  });

  test("renders dash when merchantTxnRef is missing", () => {
    const html = renderFinalResultPage({
      ...SUCCESS_PARSED,
      merchantTxnRef: null,
    });
    expect(html).toContain(">-<");
  });

  test("renders dash when meterId is missing", () => {
    const html = renderFinalResultPage({ ...SUCCESS_PARSED, meterId: null });
    expect(html).toContain(">-<");
  });

  test("renders dash when amount is missing", () => {
    const html = renderFinalResultPage({ ...SUCCESS_PARSED, amount: null });
    expect(html).toContain(">-<");
  });

  test("escapes reason to prevent XSS", () => {
    const html = renderFinalResultPage({
      ...SUCCESS_PARSED,
      reason: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes merchantTxnRef to prevent XSS", () => {
    const html = renderFinalResultPage({
      ...SUCCESS_PARSED,
      merchantTxnRef: '<b onmouseover="evil()">ref</b>',
    });
    expect(html).not.toContain("<b onmouseover");
    expect(html).toContain("&lt;b");
  });

  test("Close button calls tg.close()", () => {
    const html = renderFinalResultPage(SUCCESS_PARSED);
    expect(html).toContain("tg.close");
  });
});
