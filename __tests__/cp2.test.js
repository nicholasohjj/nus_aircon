/**
 * Unit tests for cp2Utils.js pure functions.
 *
 * Run with:
 *   npx jest __tests__/cp2.test.js
 */

const {
  escHtml,
  htmlDecode,
  extractHiddenField,
  extractMerchantTxnRef,
  extractEnetsMessage,
  ensureBaseHref,
  classifyLoginResponse,
  classifySelectOfferResponse,
  parseEvsTransactionSummary,
  normalizeFinalOutcome,
  isRedirectStatus,
  resolveUpstreamLocation,
} = require("../services/utils");

// ── Validation helpers ────────────────────────────────────────────────────────
// If isValidMeterId / isValidAmount are exported from services/vars, replace with:
// const { isValidMeterId, isValidAmount } = require("../services/vars");

function isValidMeterId(id) {
  return /^\d{8}$/.test(String(id || ""));
}

function isValidAmount(value) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 6 && n <= 50;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const PACKAGE_SELECTION_HTML = `
    <html><head><title>EVS POS Package Selection Page</title></head>
    <body>
      <form action="/EVSWebPOS/selectOfferServlet">
        <p>Please confirm you are purchasing for the above premise</p>
      </form>
    </body></html>
  `;

const MAIN_PAGE_HTML = `
    <html><head><title>EVS POS Main Page</title></head>
    <body>
      <form action="/EVSWebPOS/loginServlet">
        <p>Meter not found.</p>
      </form>
    </body></html>
  `;

const PAYMENT_SELECTION_HTML = `
    <html><head><title>EVS POS Payment Selection Page</title></head>
    <body>
      <p>Please select a payment mode</p>
      <input name="hidPurAmt" value="20.00">
      <img id="img_creditcard">
    </body></html>
  `;

const EVS_SUCCESS_HTML = `
    <html><head><title>Transaction Summary</title></head>
    <body>
      <p>Meter ID: <b><u>12345678</u></b></p>
      <p>Address: <b><u>Blk 12, 03-45 Sheares Hall</u></b></p>
      <p>Total Amount (Inclusive of GST) <b>S$ 20.00</b></p>
      <a href="/EVSWebPOS/transSumServlet?status=1&id=TXN-REF-001">link</a>
    </body></html>
  `;

const EVS_FAILURE_HTML = `
    <html><head><title>Transaction Summary</title></head>
    <body>
      <p>Transaction is rejected by financial institution.</p>
      <p>Meter ID: <b><u>12345678</u></b></p>
    </body></html>
  `;

// ── escHtml ───────────────────────────────────────────────────────────────────

describe("escHtml", () => {
  test("escapes ampersands", () => {
    expect(escHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes angle brackets", () => {
    expect(escHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes double quotes", () => {
    expect(escHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  test("handles null/undefined gracefully", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
  });

  test("leaves safe strings unchanged", () => {
    expect(escHtml("Hello World")).toBe("Hello World");
  });
});

// ── htmlDecode ────────────────────────────────────────────────────────────────

describe("htmlDecode", () => {
  test("decodes &amp;", () => {
    expect(htmlDecode("a &amp; b")).toBe("a & b");
  });

  test("decodes &lt; and &gt;", () => {
    expect(htmlDecode("&lt;div&gt;")).toBe("<div>");
  });

  test("decodes &quot;", () => {
    expect(htmlDecode("&quot;hello&quot;")).toBe('"hello"');
  });

  test("decodes &#39;", () => {
    expect(htmlDecode("it&#39;s")).toBe("it's");
  });

  test("handles empty input", () => {
    expect(htmlDecode("")).toBe("");
    expect(htmlDecode(null)).toBe("");
  });
});

// ── extractHiddenField ────────────────────────────────────────────────────────

describe("extractHiddenField", () => {
  test("extracts value when name comes before value", () => {
    const html = `<input type="hidden" name="message" value="abc123">`;
    expect(extractHiddenField(html, "message")).toBe("abc123");
  });

  test("extracts value when value comes before name", () => {
    const html = `<input type="hidden" value="xyz789" name="txnRef" >`;
    expect(extractHiddenField(html, "txnRef")).toBe("xyz789");
  });

  test("returns null when field not found", () => {
    const html = `<input type="hidden" name="other" value="something">`;
    expect(extractHiddenField(html, "message")).toBeNull();
  });

  test("handles empty/null HTML", () => {
    expect(extractHiddenField("", "message")).toBeNull();
    expect(extractHiddenField(null, "message")).toBeNull();
  });

  test("extracts from real eNETS-style markup", () => {
    const html = `
        <input type='hidden' name='netsMid' value='807574000' />
        <input type='hidden' name='netsTxnRef' value='TXN20250426' />
      `;
    expect(extractHiddenField(html, "netsMid")).toBe("807574000");
    expect(extractHiddenField(html, "netsTxnRef")).toBe("TXN20250426");
  });
});

// ── extractMerchantTxnRef ─────────────────────────────────────────────────────

describe("extractMerchantTxnRef", () => {
  test("extracts from name=merchant_txn_ref input", () => {
    const html = `<input type="hidden" name="merchant_txn_ref" value="MTR-001">`;
    expect(extractMerchantTxnRef(html)).toBe("MTR-001");
  });

  test("returns null when not present", () => {
    expect(extractMerchantTxnRef("<p>nothing here</p>")).toBeNull();
  });

  test("returns null for empty/null input", () => {
    expect(extractMerchantTxnRef("")).toBeNull();
    expect(extractMerchantTxnRef(null)).toBeNull();
  });
});

// ── extractEnetsMessage ───────────────────────────────────────────────────────

describe("extractEnetsMessage", () => {
  test("extracts message field", () => {
    const html = `<input type="hidden" name="message" value="enets-payload-xyz">`;
    expect(extractEnetsMessage(html)).toBe("enets-payload-xyz");
  });

  test("returns null when not present", () => {
    expect(extractEnetsMessage("<p>nothing</p>")).toBeNull();
  });
});

// ── ensureBaseHref ────────────────────────────────────────────────────────────

describe("ensureBaseHref", () => {
  test("injects base href when not present", () => {
    const html = `<html><head></head><body></body></html>`;
    const result = ensureBaseHref(html, "https://www.enets.sg/");
    expect(result).toContain('<base href="https://www.enets.sg/">');
  });

  test("does not inject if base tag already exists", () => {
    const html = `<html><head><base href="https://existing.com/"></head><body></body></html>`;
    const result = ensureBaseHref(html, "https://www.enets.sg/");
    expect(result).not.toContain("https://www.enets.sg/");
    expect(result).toContain("https://existing.com/");
  });

  test("returns empty string for empty input", () => {
    expect(ensureBaseHref("", "https://www.enets.sg/")).toBe("");
  });

  test("returns original if no head tag found", () => {
    const html = `<body>no head tag here</body>`;
    expect(ensureBaseHref(html, "https://www.enets.sg/")).toBe(html);
  });
});

// ── isValidMeterId ────────────────────────────────────────────────────────────

describe("isValidMeterId", () => {
  test("accepts exactly 8 digits", () => {
    expect(isValidMeterId("12345678")).toBe(true);
    expect(isValidMeterId("00000000")).toBe(true);
  });

  test("rejects fewer than 8 digits", () => {
    expect(isValidMeterId("1234567")).toBe(false);
  });

  test("rejects more than 8 digits", () => {
    expect(isValidMeterId("123456789")).toBe(false);
  });

  test("rejects non-numeric characters", () => {
    expect(isValidMeterId("1234567a")).toBe(false);
    expect(isValidMeterId("abcdefgh")).toBe(false);
  });

  test("rejects empty/null/undefined", () => {
    expect(isValidMeterId("")).toBe(false);
    expect(isValidMeterId(null)).toBe(false);
    expect(isValidMeterId(undefined)).toBe(false);
  });
});

// ── isValidAmount ─────────────────────────────────────────────────────────────

describe("isValidAmount", () => {
  test("accepts minimum amount ($6)", () => {
    expect(isValidAmount(6)).toBe(true);
    expect(isValidAmount("6")).toBe(true);
    expect(isValidAmount("6.00")).toBe(true);
  });

  test("accepts maximum amount ($50)", () => {
    expect(isValidAmount(50)).toBe(true);
    expect(isValidAmount("50.00")).toBe(true);
  });

  test("accepts mid-range amounts", () => {
    expect(isValidAmount(20)).toBe(true);
    expect(isValidAmount("30.50")).toBe(true);
  });

  test("rejects below minimum", () => {
    expect(isValidAmount(5.99)).toBe(false);
    expect(isValidAmount("5")).toBe(false);
    expect(isValidAmount(0)).toBe(false);
  });

  test("rejects above maximum", () => {
    expect(isValidAmount(50.01)).toBe(false);
    expect(isValidAmount(100)).toBe(false);
  });

  test("rejects empty/null/undefined", () => {
    expect(isValidAmount("")).toBe(false);
    expect(isValidAmount(null)).toBe(false);
    expect(isValidAmount(undefined)).toBe(false);
  });

  test("rejects non-numeric strings", () => {
    expect(isValidAmount("abc")).toBe(false);
  });
});

// ── classifyLoginResponse ─────────────────────────────────────────────────────

describe("classifyLoginResponse", () => {
  test("returns 'valid' for package selection page title", () => {
    expect(classifyLoginResponse(PACKAGE_SELECTION_HTML)).toBe("valid");
  });

  test("returns 'valid' for selectOfferServlet action", () => {
    const html = `<form action="/EVSWebPOS/selectOfferServlet"></form>`;
    expect(classifyLoginResponse(html)).toBe("valid");
  });

  test("returns 'valid' for premise confirmation text", () => {
    const html = `<p>Please confirm you are purchasing for the above premise</p>`;
    expect(classifyLoginResponse(html)).toBe("valid");
  });

  test("returns 'invalid' for main page title", () => {
    expect(classifyLoginResponse(MAIN_PAGE_HTML)).toBe("invalid");
  });

  test("returns 'invalid' when meter not found", () => {
    const html = `<p>Meter not found.</p>`;
    expect(classifyLoginResponse(html)).toBe("invalid");
  });

  test("returns 'invalid' for loginServlet action", () => {
    const html = `<form action="/EVSWebPOS/loginServlet"></form>`;
    expect(classifyLoginResponse(html)).toBe("invalid");
  });

  test("returns 'unknown' for unrecognised HTML", () => {
    expect(
      classifyLoginResponse("<html><body>Something else</body></html>"),
    ).toBe("unknown");
  });

  test("returns 'unknown' for empty/null input", () => {
    expect(classifyLoginResponse("")).toBe("unknown");
    expect(classifyLoginResponse(null)).toBe("unknown");
  });
});

// ── classifySelectOfferResponse ───────────────────────────────────────────────

describe("classifySelectOfferResponse", () => {
  test("returns 'success' for payment selection page title", () => {
    expect(classifySelectOfferResponse(PAYMENT_SELECTION_HTML)).toBe("success");
  });

  test("returns 'success' for 'Please select a payment mode'", () => {
    const html = `<p>Please select a payment mode</p>`;
    expect(classifySelectOfferResponse(html)).toBe("success");
  });

  test("returns 'success' for img_creditcard", () => {
    const html = `<img id="img_creditcard">`;
    expect(classifySelectOfferResponse(html)).toBe("success");
  });

  test("returns 'success' for hidPurAmt field", () => {
    const html = `<input name="hidPurAmt" value="20.00">`;
    expect(classifySelectOfferResponse(html)).toBe("success");
  });

  test("returns 'session_or_login_failed' for main page", () => {
    expect(classifySelectOfferResponse(MAIN_PAGE_HTML)).toBe(
      "session_or_login_failed",
    );
  });

  test("returns 'stayed_on_package_page' for package selection page", () => {
    expect(classifySelectOfferResponse(PACKAGE_SELECTION_HTML)).toBe(
      "stayed_on_package_page",
    );
  });

  test("returns 'unknown' for unrecognised HTML", () => {
    expect(classifySelectOfferResponse("<p>Random page</p>")).toBe("unknown");
  });
});

// ── normalizeFinalOutcome ─────────────────────────────────────────────────────

describe("normalizeFinalOutcome", () => {
  test("returns success when status is not failure", () => {
    const result = normalizeFinalOutcome({
      status: "success",
      reason: "Payment completed.",
    });
    expect(result.status).toBe("success");
    expect(result.reason).toBe("Payment completed.");
  });

  test("returns failure when status is 'failure'", () => {
    const result = normalizeFinalOutcome({
      status: "failure",
      reason: "Something went wrong.",
    });
    expect(result.status).toBe("failure");
  });

  test("returns failure when reason contains rejection text", () => {
    const result = normalizeFinalOutcome({
      status: "unknown",
      reason: "Transaction is rejected by financial institution.",
    });
    expect(result.status).toBe("failure");
  });

  test("returns failure when reason contains 'failed to purchase'", () => {
    const result = normalizeFinalOutcome({
      status: "unknown",
      reason: "Failed to purchase electricity.",
    });
    expect(result.status).toBe("failure");
  });

  test("defaults reason when missing", () => {
    const result = normalizeFinalOutcome({});
    expect(result.reason).toBe("Payment completed.");
    expect(result.status).toBe("success");
  });

  test("preserves other fields from parsed object", () => {
    const result = normalizeFinalOutcome({
      status: "success",
      reason: "OK",
      meterId: "12345678",
      amount: "S$ 20.00",
    });
    expect(result.meterId).toBe("12345678");
    expect(result.amount).toBe("S$ 20.00");
  });

  test("case-insensitive match for rejection text", () => {
    const result = normalizeFinalOutcome({
      status: "unknown",
      reason: "REJECTED BY FINANCIAL INSTITUTION",
    });
    expect(result.status).toBe("failure");
  });
});

// ── parseEvsTransactionSummary ────────────────────────────────────────────────

describe("parseEvsTransactionSummary", () => {
  test("parses a successful transaction", () => {
    const result = parseEvsTransactionSummary(EVS_SUCCESS_HTML);
    expect(result.status).toBe("success");
    expect(result.meterId).toBe("12345678");
    expect(result.address).toBe("Blk 12, 03-45 Sheares Hall");
    expect(result.amount).toBe("S$ 20.00");
    expect(result.reason).toBe("Payment completed.");
  });

  test("parses a failed transaction", () => {
    const result = parseEvsTransactionSummary(EVS_FAILURE_HTML);
    expect(result.status).toBe("failure");
    expect(result.reason).toBe(
      "Transaction is rejected by financial institution.",
    );
    expect(result.meterId).toBe("12345678");
  });

  test("extracts title", () => {
    const result = parseEvsTransactionSummary(EVS_SUCCESS_HTML);
    expect(result.title).toBe("Transaction Summary");
  });

  test("extracts merchantTxnRef from URL with &id=", () => {
    const html = `<a href="/EVSWebPOS/transSumServlet?status=1&id=MYREF123">link</a>`;
    expect(parseEvsTransactionSummary(html).merchantTxnRef).toBe("MYREF123");
  });

  test("extracts merchantTxnRef from URL with &amp;id=", () => {
    const html = `<a href="/EVSWebPOS/transSumServlet?status=1&amp;id=MYREF456">link</a>`;
    expect(parseEvsTransactionSummary(html).merchantTxnRef).toBe("MYREF456");
  });

  test("returns nulls for missing fields on empty HTML", () => {
    const result = parseEvsTransactionSummary("");
    expect(result.title).toBeNull();
    expect(result.merchantTxnRef).toBeNull();
    expect(result.meterId).toBeNull();
    expect(result.address).toBeNull();
    expect(result.amount).toBeNull();
  });

  test("handles null input", () => {
    const result = parseEvsTransactionSummary(null);
    expect(result.status).toBe("success");
    expect(result.meterId).toBeNull();
  });
});

// ── isRedirectStatus ──────────────────────────────────────────────────────────

describe("isRedirectStatus", () => {
  test.each([301, 302, 303, 307, 308])("returns true for %i", (status) => {
    expect(isRedirectStatus(status)).toBe(true);
  });

  test.each([200, 400, 404, 500])("returns false for %i", (status) => {
    expect(isRedirectStatus(status)).toBe(false);
  });
});

// ── resolveUpstreamLocation ───────────────────────────────────────────────────

describe("resolveUpstreamLocation", () => {
  test("resolves absolute URL unchanged", () => {
    expect(
      resolveUpstreamLocation("https://example.com", "https://other.com/path"),
    ).toBe("https://other.com/path");
  });

  test("resolves relative path against base URL", () => {
    expect(resolveUpstreamLocation("https://example.com/foo", "/bar")).toBe(
      "https://example.com/bar",
    );
  });

  test("returns null for invalid input", () => {
    expect(resolveUpstreamLocation("not-a-url", "also-not-a-url")).toBeNull();
  });
});
