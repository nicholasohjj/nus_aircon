/**
 * Pure utility functions for the CP2 payment flow.
 * Extracted for testability and reuse across routes.
 */

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlDecode(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractHiddenField(html, name) {
  const m =
    String(html || "").match(
      new RegExp(
        `<input[^>]*\\bname=['"]${name}['"][^>]*\\bvalue=['"]([^'"]*)['"\\s]`,
        "i",
      ),
    ) ||
    String(html || "").match(
      new RegExp(
        `<input[^>]*\\bvalue=['"]([^'"]*)['"\\s][^>]*\\bname=['"]${name}['"]`,
        "i",
      ),
    );
  return m?.[1] || null;
}

function extractMerchantTxnRef(html) {
  const body = String(html || "");
  const m =
    body.match(
      /<input[^>]*\bname=['"]merchant_txn_ref['"][^>]*\bvalue=['"]([^'"]+)['"][^>]*>/i,
    ) || body.match(/\bmerchant_txn_ref\b[^]*?\bvalue=['"]([^'"]+)['"]/i);
  return m?.[1] || null;
}

function extractEnetsMessage(html) {
  const body = String(html || "");
  const m = body.match(
    /<input[^>]*\bname=['"]message['"][^>]*\bvalue=['"]([^'"]+)['"][^>]*>/i,
  );
  return m?.[1] || null;
}

function ensureBaseHref(html, baseHref) {
  const body = String(html || "");
  if (!body) return body;
  if (/<base\b/i.test(body)) return body;
  const headOpen = body.match(/<head\b[^>]*>/i)?.[0];
  if (!headOpen) return body;
  return body.replace(
    /<head\b[^>]*>/i,
    `${headOpen}\n<base href="${String(baseHref)}">`,
  );
}

// ── Response classifiers ──────────────────────────────────────────────────────

function classifyLoginResponse(html) {
  const body = String(html || "");
  const isValid =
    body.includes("<title>EVS POS Package Selection Page</title>") ||
    body.includes('action="/EVSWebPOS/selectOfferServlet"') ||
    body.includes("Please confirm you are purchasing for the above premise");
  const isInvalid =
    body.includes("<title>EVS POS Main Page</title>") ||
    body.includes("Meter not found.") ||
    body.includes('action="/EVSWebPOS/loginServlet"');
  if (isValid) return "valid";
  if (isInvalid) return "invalid";
  return "unknown";
}

function classifySelectOfferResponse(html) {
  const body = String(html || "");
  const isSuccess =
    body.includes("<title>EVS POS Payment Selection Page</title>") ||
    body.includes("Please select a payment mode") ||
    body.includes("img_creditcard") ||
    body.includes("hidPurAmt");
  const isMainPage =
    body.includes("<title>EVS POS Main Page</title>") ||
    body.includes("Meter not found.") ||
    body.includes('action="/EVSWebPOS/loginServlet"');
  const isPackagePage =
    body.includes("<title>EVS POS Package Selection Page</title>") ||
    body.includes("Please confirm you are purchasing for the above premise") ||
    body.includes('action="/EVSWebPOS/selectOfferServlet"');
  if (isSuccess) return "success";
  if (isMainPage) return "session_or_login_failed";
  if (isPackagePage) return "stayed_on_package_page";
  return "unknown";
}

// ── Transaction parsing ───────────────────────────────────────────────────────

function parseEvsTransactionSummary(html) {
  const body = String(html || "");

  const title = body.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || null;

  const merchantTxnRef =
    body.match(/transSumServlet\?status=\d+&amp;id=([^"&]+)/i)?.[1] ||
    body.match(/transSumServlet\?status=\d+&id=([^"&]+)/i)?.[1] ||
    null;

  const meterId =
    body.match(/Meter ID[\s\S]*?<b><u>(\d{5,})<\/u><\/b>/i)?.[1] ||
    body.match(/<b><u>(\d{5,})<\/u><\/b>/i)?.[1] ||
    null;

  const address =
    body.match(/Address[\s\S]*?<b><u>([^<]+)<\/u><\/b>/i)?.[1]?.trim() || null;

  const amount =
    body
      .match(
        /Total Amount \(Inclusive of GST\)[\s\S]*?<b>(S\$ ?[\d.]+)<\/b>/i,
      )?.[1]
      ?.trim() ||
    body.match(/<b>S\$ ?([\d.]+)<\/b>/i)?.[1] ||
    null;

  const isFailure = /Transaction is rejected by financial institution\./i.test(
    body,
  );

  return {
    title,
    merchantTxnRef,
    meterId,
    address,
    amount,
    status: isFailure ? "failure" : "success",
    reason: isFailure
      ? "Transaction is rejected by financial institution."
      : "Payment completed.",
  };
}

function parseEnetsResult(html) {
  const body = String(html || "");

  const match = body.match(/window\.open\(['"]([^'"]+)['"]/i);
  if (match) {
    let url = match[1];
    url = url.replace(/\?status=([^&?]+)\?/, "?status=$1&");

    const qIndex = url.indexOf("?");
    if (qIndex !== -1) {
      const rawQuery = url.slice(qIndex + 1);
      const params = {};
      for (const pair of rawQuery.split("&")) {
        const eq = pair.indexOf("=");
        if (eq === -1) continue;
        const key = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        params[key] = value;
      }

      return {
        status: params.status || "unknown",
        bankAuthId: params.bankAuthId || null,
        merchantTxnRef: params.merchantTxnRef || null,
        netsTxnRef: params.netsTxnRef || null,
        txnDateTime: params.txnDateTime || null,
        error: params.error || null,
        deductedAmount: params.deductedAmount || null,
        source: "window_open",
      };
    }
  }

  const isReceiptPage =
    /<title>\s*Receipt\s*<\/title>/i.test(body) || /u_receipt_/i.test(body);

  if (isReceiptPage) {
    const liMatches = [...body.matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map(
      (m) => m[1].trim(),
    );
    const message = liMatches.join(" | ") || null;

    let status = "unknown";
    if (
      /please contact merchant/i.test(body) ||
      /fail|declin|reject/i.test(body)
    ) {
      status = "failure";
    } else if (/success|approved|completed/i.test(body)) {
      status = "success";
    }

    return {
      status,
      bankAuthId: null,
      merchantTxnRef: null,
      netsTxnRef: null,
      txnDateTime: null,
      error: message,
      deductedAmount: null,
      source: "receipt_html",
    };
  }

  return null;
}

// ── Outcome normalisation ─────────────────────────────────────────────────────

function normalizeFinalOutcome(parsed = {}) {
  const reason = parsed.reason || "Unable to determine transaction outcome.";
  const isFailure =
    parsed.status === "failure" ||
    /rejected by financial institution/i.test(reason) ||
    /failed to purchase/i.test(reason);
  return {
    ...parsed,
    status: isFailure ? "failure" : "success",
    reason: isFailure ? reason : "Payment completed.",
  };
}

// ── Redirect helpers ──────────────────────────────────────────────────────────

function isRedirectStatus(status) {
  const s = Number(status);
  return s === 301 || s === 302 || s === 303 || s === 307 || s === 308;
}

function resolveUpstreamLocation(baseUrl, location) {
  try {
    return new URL(String(location), String(baseUrl)).toString();
  } catch {
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  escHtml,
  htmlDecode,
  extractHiddenField,
  extractMerchantTxnRef,
  extractEnetsMessage,
  ensureBaseHref,
  classifyLoginResponse,
  classifySelectOfferResponse,
  parseEvsTransactionSummary,
  parseEnetsResult,
  normalizeFinalOutcome,
  isRedirectStatus,
  resolveUpstreamLocation,
};
