import { describe, test, expect, vi, beforeEach } from "vitest";

const { extractEvsCallbackFromHtml } = require("../services/cp2Service");

// ── Test fixtures ─────────────────────────────────────────────────────────────

// eNETS response HTML containing an EVS transSumServlet callback form
// Uses unescaped & in action URL (most common case)
const CALLBACK_HTML_AMP = `
<html><body>
  <form id="post_form" method="POST"
    action="https://cp2.evs.com.sg/EVSWebPOS/transSumServlet?status=1&id=TXN-REF-001">
    <input type="hidden" name="message" value="enets-callback-payload-abc">
  </form>
</body></html>
`;

// Same but action URL uses HTML-encoded &amp; (also seen in real responses)
const CALLBACK_HTML_AMP_ENTITY = `
<html><body>
  <form method="POST"
    action="https://cp2.evs.com.sg/EVSWebPOS/transSumServlet?status=0&amp;id=TXN-REF-002">
    <input type="hidden" name="message" value="enets-callback-payload-xyz">
  </form>
</body></html>
`;

// Failure status (status=0 means failure in EVS convention for this endpoint)
const CALLBACK_HTML_FAILURE = `
<html><body>
  <form method="POST"
    action="https://cp2.evs.com.sg/EVSWebPOS/transSumServlet?status=0&id=TXN-REF-FAIL">
    <input type="hidden" name="message" value="failure-payload">
  </form>
</body></html>
`;

// No transSumServlet form — eNETS receipt page instead
const ENETS_RECEIPT_HTML = `
<html><body>
  <p>Transaction Successful</p>
  <p>Merchant Txn Ref: MTR-001</p>
  <p>Amount deducted: S$ 20.00</p>
</body></html>
`;

// Form present but message field missing
const CALLBACK_HTML_NO_MESSAGE = `
<html><body>
  <form method="POST"
    action="https://cp2.evs.com.sg/EVSWebPOS/transSumServlet?status=1&id=TXN-REF-003">
  </form>
</body></html>
`;

// Form present but id param missing from action URL
const CALLBACK_HTML_NO_ID = `
<html><body>
  <form method="POST"
    action="https://cp2.evs.com.sg/EVSWebPOS/transSumServlet?status=1">
    <input type="hidden" name="message" value="some-payload">
  </form>
</body></html>
`;

// Single quotes in form attributes
const CALLBACK_HTML_SINGLE_QUOTES = `
<html><body>
  <form method='POST'
    action='https://cp2.evs.com.sg/EVSWebPOS/transSumServlet?status=1&id=TXN-SQ-001'>
    <input type='hidden' name='message' value='sq-payload'>
  </form>
</body></html>
`;

// ── extractEvsCallbackFromHtml ────────────────────────────────────────────────

describe("extractEvsCallbackFromHtml", () => {
  test("extracts action, status, id, message from standard HTML", () => {
    const result = extractEvsCallbackFromHtml(CALLBACK_HTML_AMP);
    expect(result).not.toBeNull();
    expect(result.status).toBe("1");
    expect(result.id).toBe("TXN-REF-001");
    expect(result.message).toBe("enets-callback-payload-abc");
    expect(result.action).toContain("transSumServlet");
  });

  test("handles &amp; entity in action URL", () => {
    const result = extractEvsCallbackFromHtml(CALLBACK_HTML_AMP_ENTITY);
    expect(result).not.toBeNull();
    expect(result.status).toBe("0");
    expect(result.id).toBe("TXN-REF-002");
    expect(result.message).toBe("enets-callback-payload-xyz");
  });

  test("returns null when no transSumServlet form present", () => {
    expect(extractEvsCallbackFromHtml(ENETS_RECEIPT_HTML)).toBeNull();
  });

  test("returns null when message field is missing", () => {
    expect(extractEvsCallbackFromHtml(CALLBACK_HTML_NO_MESSAGE)).toBeNull();
  });

  test("returns null when id param is missing from action URL", () => {
    expect(extractEvsCallbackFromHtml(CALLBACK_HTML_NO_ID)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractEvsCallbackFromHtml("")).toBeNull();
  });

  test("returns null for null input", () => {
    expect(extractEvsCallbackFromHtml(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(extractEvsCallbackFromHtml(undefined)).toBeNull();
  });

  test("extracts failure status correctly", () => {
    const result = extractEvsCallbackFromHtml(CALLBACK_HTML_FAILURE);
    expect(result).not.toBeNull();
    expect(result.status).toBe("0");
    expect(result.id).toBe("TXN-REF-FAIL");
    expect(result.message).toBe("failure-payload");
  });

  test("action field contains the transSumServlet URL", () => {
    const result = extractEvsCallbackFromHtml(CALLBACK_HTML_AMP);
    expect(result.action).toContain("transSumServlet");
  });

  test("all four fields are present on a valid result", () => {
    const result = extractEvsCallbackFromHtml(CALLBACK_HTML_AMP);
    expect(result).toHaveProperty("action");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("message");
  });

  test("handles HTML with surrounding noise (scripts, other forms)", () => {
    const html = `
      <script>var x = 1;</script>
      <form action="/other/path"><input name="foo" value="bar"></form>
      ${CALLBACK_HTML_AMP}
      <p>Some trailing content</p>
    `;
    const result = extractEvsCallbackFromHtml(html);
    expect(result).not.toBeNull();
    expect(result.id).toBe("TXN-REF-001");
  });

  test("produces string type for status and id", () => {
    const result = extractEvsCallbackFromHtml(CALLBACK_HTML_AMP);
    expect(typeof result.status).toBe("string");
    expect(typeof result.id).toBe("string");
  });
});

// ── isCp2Meter (integration-style with mocked axios) ─────────────────────────
// These tests mock the HTTP layer so no real network call is made.

describe("isCp2Meter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("returns { ok: false } for an invalid/unknown meter", async () => {
    vi.doMock("axios", () => ({
      default: {
        post: vi.fn().mockResolvedValue({
          status: 200,
          data: `<html><head><title>EVS POS Main Page</title></head>
            <body><form action="/EVSWebPOS/loginServlet"></form></body></html>`,
        }),
      },
    }));
    const { isCp2Meter } = await import("../services/cp2Service");
    const result = await isCp2Meter("99999999");
    expect(result.ok).toBe(false);
    expect(result.result).toBe("invalid");
  });
});
