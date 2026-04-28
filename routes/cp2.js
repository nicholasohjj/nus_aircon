require("dotenv").config();
const express = require("express");
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { getMeterSummary } = require("../services/ore");
const { track, captureException } = require("../services/analytics");
const { isValidAmount, isValidMeterId } = require("../services/validators");
const {
  extractHiddenField,
  extractMerchantTxnRef,
  ensureBaseHref,
  parseEvsTransactionSummary,
  parseEnetsResult,
  normalizeFinalOutcome,
} = require("../services/utils");
const {
  errorPage,
  loadingPage,
  cardPaymentPage,
  renderFinalResultPage,
} = require("../views/cp2");
const {
  runPurchaseFlow,
  postResultToEvs,
  extractEvsCallbackFromHtml,
} = require("../services/cp2Service");
const { DEFAULT_HEADERS, CP2_WEBPOS_BASE } = require("../services/config");
router.use(express.urlencoded({ extended: false }));
router.use(express.json());

// ── Existing routes ───────────────────────────────────────────────────────────

router.post("/purchase_flow", async (req, res) => {
  try {
    console.log(req.body);
    const out = await runPurchaseFlow(req.body || {});
    console.log("OUT: ", out);
    const status =
      out?.error &&
      (out.error.includes("Missing") || out.error.includes("Invalid"))
        ? 400
        : 200;
    return res.status(status).json(out);
  } catch (error) {
    captureException(error, "anonymous", {
      route: "cp2",
      endpoint: "/purchase_flow",
    });
    return res.status(500).json({
      error: error.message,
      responseStatus: error.response?.status || null,
    });
  }
});

router.get("/purchase_flow/enets", async (req, res) => {
  try {
    const out = await runPurchaseFlow(req.query || {});
    if (!out?.ok || !out?.enetsBody) return res.status(502).json(out);
    const html = ensureBaseHref(out.enetsBody, "https://www.enets.sg/");
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send(String(error?.message || error));
  }
});

router.get("/webapp/result", (req, res) => {
  const {
    status = "unknown",
    ref = "",
    meterId = "",
    amount = "",
    reason = "",
    address = "",
    balance = "",
  } = req.query;

  const eventName =
    status === "success" ? "payment_completed" : "payment_failed";
  track(eventName, {
    meterId,
    amount,
    status,
    merchantTxnRef: ref,
    reason: reason || null,
  });

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  return res.send(
    renderFinalResultPage({
      status,
      merchantTxnRef: ref,
      meterId,
      amount,
      reason,
      address,
      balance,
    }),
  );
});

router.get("/webapp/bootstrap", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      error: "Missing meter ID or amount.",
    });
  }

  if (!isValidMeterId(txtMtrId)) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      error: "Meter ID must be exactly 8 digits.",
    });
  }

  if (!isValidAmount(txtAmount)) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      error: "Amount must be between $6.00 and $50.00.",
    });
  }

  try {
    const [out, meterSummary] = await Promise.all([
      runPurchaseFlow({ txtMtrId, txtAmount }),
      getMeterSummary(txtMtrId),
    ]);

    track("bootstrap_started", { meterId: txtMtrId, amount: txtAmount });

    if (!out?.ok) {
      track("bootstrap_failed", {
        meterId: txtMtrId,
        amount: txtAmount,
        stage: out.stage,
        error: out.error || null,
      });
      return res.status(502).json(out);
    }

    track("bootstrap_succeeded", {
      meterId: txtMtrId,
      amount: txtAmount,
      stage: out.stage,
    });

    const enetsHtml = String(out.enetsBody || "");
    const $ = cheerio.load(enetsHtml);

    const netsMid = extractHiddenField(enetsHtml, "netsMid");
    const e = extractHiddenField(enetsHtml, "e");
    const n = extractHiddenField(enetsHtml, "n");
    const netsTxnRef = extractHiddenField(enetsHtml, "netsTxnRef");
    const merchantTxnRef =
      extractHiddenField(enetsHtml, "merchant_txn_ref") ||
      extractMerchantTxnRef(enetsHtml);
    const rawActionUrl =
      $("form").first().attr("action") || "/enets2/PaymentListener.do";
    const actionUrl = new URL(rawActionUrl, "https://www.enets.sg").toString();

    if (!n || !e || !netsMid || !netsTxnRef) {
      return res
        .status(502)
        .json({ ok: false, error: "Missing eNETS key fields." });
    }

    const params = new URLSearchParams({
      txtMtrId,
      txtAmount,
      address: meterSummary.address || "",
      balance: meterSummary.credit_bal ?? "",
      n,
      e,
      netsMid,
      netsTxnRef,
      merchantTxnRef: merchantTxnRef || "",
      actionUrl,
    });

    return res.status(200).json({
      ok: true,
      stage: out.stage,
      redirectUrl: "/webapp/pay?" + params.toString(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      stage: "init",
      error: err.message || "Unknown error",
    });
  }
});

router.get("/evs/merchant_txn_ref", async (req, res) => {
  try {
    const { mode = "0", isDedicated = "1", jsessionid } = req.query;
    const cookieFromHeader = req.header("cookie") || "";
    const cookieHeader =
      jsessionid && String(jsessionid).trim()
        ? `JSESSIONID=${String(jsessionid).trim()}`
        : cookieFromHeader;
    const response = await axios.get(
      `${CP2_WEBPOS_BASE}/EVSWebPOS/paymentServlet`,
      {
        params: { mode: String(mode), isDedicated: String(isDedicated) },
        headers: {
          ...DEFAULT_HEADERS,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          Referer: `${CP2_WEBPOS_BASE}/EVSWebPOS/selectOfferServlet`,
        },
        validateStatus: () => true,
        maxRedirects: 5,
      },
    );
    if (response.status !== 200)
      return res.status(502).json({
        error: "Upstream returned non-200",
        upstreamStatus: response.status,
      });
    const merchant_txn_ref = extractMerchantTxnRef(response.data);
    if (!merchant_txn_ref) {
      return res.status(502).json({
        error: "merchant_txn_ref not found in upstream HTML",
        upstreamStatus: response.status,
        upstreamTitle:
          String(response.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        upstreamContentType: response.headers?.["content-type"] || null,
        upstreamPreview: String(response.data || "").slice(0, 800),
      });
    }
    return res.status(200).json({ merchant_txn_ref });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      responseStatus: error.response?.status || null,
    });
  }
});

router.post(
  "/webapp/enets_pay",
  express.urlencoded({ extended: false, limit: "10mb" }),
  async (req, res) => {
    try {
      const body = new URLSearchParams(req.body).toString();

      track("payment_attempted", {
        meterId: req.body.meterId,
        amount: req.body.amount,
        merchantTxnRef: req.body.merchantTxnRef,
      });
      const enetsResp = await axios.post(
        "https://www.enets.sg/GW2/uCredit/pay",
        body,
        {
          headers: {
            ...DEFAULT_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://www.enets.sg",
            Referer: "https://www.enets.sg/enets2/PaymentListener.do",
          },
          validateStatus: () => true,
          maxRedirects: 5,
        },
      );

      const html = String(enetsResp.data || "");

      // Preferred path: capture the callback form/message and replay it to EVS
      const evsCb = extractEvsCallbackFromHtml(html);

      if (evsCb) {
        const jsessionid =
          req.body.jsessionid ||
          req.headers.cookie?.match(/(?:^|;\s*)JSESSIONID=([^;]+)/i)?.[1] ||
          null;

        const evsResult = await postResultToEvs({
          status: evsCb.status,
          id: evsCb.id,
          message: evsCb.message,
          jsessionid,
        });

        const parsed = evsResult.parsed || {};
        const normalized = normalizeFinalOutcome(parsed);

        track("payment_result", {
          meterId: req.body.meterId,
          amount: req.body.amount,
          merchantTxnRef: normalized.merchantTxnRef || "",
          status: normalized.status,
          reason: normalized.reason || "",
        });

        return res.status(200).json({
          ok: true,
          source: "evs_transsum",
          status: normalized.status || "unknown",
          merchantTxnRef:
            normalized.merchantTxnRef ||
            evsCb.id ||
            req.body.merchantTxnRef ||
            "",
          meterId: req.body.meterId || normalized.meterId || "",
          address: req.body.address || "",
          balance: req.body.balance || "",
          amount: req.body.amount || normalized.amount || "",
          reason: normalized.reason || "",
          upstreamStatus: {
            enets: enetsResp.status,
            evs: evsResult.upstreamStatus,
          },
        });
      }

      // Fallback: old receipt parser if callback form is not found
      const receipt = parseEnetsResult(html);

      if (!receipt) {
        return res.status(502).json({
          ok: false,
          error: "Could not parse eNETS response or EVS callback form",
          preview: html.slice(0, 1200),
        });
      }

      const ok = receipt.status === "success";

      return res.status(200).json({
        ok: true,
        source: "enets_receipt_fallback",
        status: receipt.status,
        merchantTxnRef:
          receipt.merchantTxnRef ||
          req.body.merchantTxnRef ||
          req.body.merchant_txn_ref ||
          "",
        amount: receipt.deductedAmount || "",
        reason: ok
          ? "Payment completed."
          : receipt.error || "Transaction failed.",
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  },
);

router.get("/webapp/pay", (req, res) => {
  const {
    txtMtrId,
    txtAmount,
    address = "",
    balance = "",
    n,
    e,
    netsMid,
    netsTxnRef,
    merchantTxnRef,
    actionUrl,
  } = req.query;

  if (!txtMtrId || !txtAmount || !n || !e || !netsMid || !netsTxnRef) {
    return res
      .status(400)
      .send(errorPage("Missing required payment parameters."));
  }

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  return res.send(
    cardPaymentPage({
      n,
      e,
      netsMid,
      netsTxnRef,
      merchantTxnRef: merchantTxnRef || "",
      actionUrl: actionUrl || "https://www.enets.sg/enets2/PaymentListener.do",
      amount: txtAmount,
      meterId: txtMtrId,
      address,
      balance,
    }),
  );
});

router.post("/evs/creditpayment", async (req, res) => {
  try {
    const {
      mode = "0",
      isDedicated = "1",
      jsessionid,
      amt = "0.01",
      payment_mode = "CC",
      txn_amount = "1",
      currency_code = "SGD",
      submission_mode = "B",
      payment_type = "SALE",
    } = req.body || {};
    const cookieFromHeader = req.header("cookie") || "";
    const cookieHeader =
      jsessionid && String(jsessionid).trim()
        ? `JSESSIONID=${String(jsessionid).trim()}`
        : cookieFromHeader;
    const evsResp = await axios.get(
      `${CP2_WEBPOS_BASE}/EVSWebPOS/paymentServlet`,
      {
        params: { mode: String(mode), isDedicated: String(isDedicated) },
        headers: {
          ...DEFAULT_HEADERS,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          Referer: `${CP2_WEBPOS_BASE}/EVSWebPOS/selectOfferServlet`,
        },
        validateStatus: () => true,
        maxRedirects: 5,
      },
    );
    if (evsResp.status !== 200)
      return res.status(502).json({
        error: "EVS paymentServlet returned non-200",
        upstreamStatus: evsResp.status,
      });
    const merchant_txn_ref = extractMerchantTxnRef(evsResp.data);
    if (!merchant_txn_ref) {
      return res.status(502).json({
        error: "merchant_txn_ref not found in EVS HTML",
        upstreamStatus: evsResp.status,
        upstreamTitle:
          String(evsResp.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        upstreamContentType: evsResp.headers?.["content-type"] || null,
        upstreamPreview: String(evsResp.data || "").slice(0, 800),
      });
    }
    const formBody = new URLSearchParams({
      amt: String(amt),
      payment_mode: String(payment_mode),
      txn_amount: String(txn_amount),
      currency_code: String(currency_code),
      merchant_txn_ref: String(merchant_txn_ref),
      submission_mode: String(submission_mode),
      payment_type: String(payment_type),
    }).toString();
    const payResp = await axios.post(
      "http://120.50.44.233/payment/creditpayment.jsp",
      formBody,
      {
        headers: {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        validateStatus: () => true,
      },
    );
    return res.status(200).json({
      merchant_txn_ref,
      paymentUpstreamStatus: payResp.status,
      paymentContentType: payResp.headers?.["content-type"] || null,
      paymentBody:
        typeof payResp.data === "string" ? payResp.data : payResp.data,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      responseStatus: error.response?.status || null,
    });
  }
});

// ── NEW: Telegram WebApp route ────────────────────────────────────────────────
// Serves a loading page, runs the full purchase flow server-side,
// then renders the eNETS payment page directly inside the WebApp.

router.get("/", (req, res) => {
  res.send("Hello World");
});

router.get("/webapp", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res.status(400).send(errorPage("Missing meter ID or amount."));
  }

  if (!isValidMeterId(txtMtrId)) {
    return res
      .status(400)
      .send(errorPage("Meter ID must be exactly 8 digits."));
  }

  if (!isValidAmount(txtAmount)) {
    return res
      .status(400)
      .send(errorPage("Amount must be between $6.00 and $50.00."));
  }

  try {
    const meterSummary = await getMeterSummary(txtMtrId);
    track("webapp_opened", {
      route: "cp2",
      meterId: txtMtrId,
      amount: txtAmount,
      ua: req.get("user-agent"),
    });
    return res.status(200).send(loadingPage(txtMtrId, txtAmount, meterSummary));
  } catch (err) {
    return res
      .status(200)
      .send(
        loadingPage(txtMtrId, txtAmount, { address: null, credit_bal: null }),
      );
  }
});

router.post(
  "/webapp/transsum",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const { status = "0", id } = req.query;
      const { message } = req.body || {};

      if (!message || !id) {
        return res
          .status(400)
          .send(errorPage("Missing transaction return data."));
      }

      const formBody = new URLSearchParams({
        message: String(message),
      }).toString();

      const evsResp = await axios.post(
        `${CP2_WEBPOS_BASE}/EVSWebPOS/transSumServlet?status=${encodeURIComponent(String(status))}&id=${encodeURIComponent(String(id))}`,
        formBody,
        {
          headers: {
            ...DEFAULT_HEADERS,
            Origin: "https://www.enets.sg",
            Referer: "https://www.enets.sg/",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          validateStatus: () => true,
        },
      );

      const parsed = parseEvsTransactionSummary(evsResp.data);

      res.setHeader("Content-Type", "text/html; charset=UTF-8");
      const q = new URLSearchParams({
        status: parsed.status || "unknown",
        ref: parsed.merchantTxnRef || "",
        meterId: parsed.meterId || "",
        amount: parsed.amount || "",
        reason: parsed.reason || "",
        address: parsed.address || "",
        balance: parsed.balance ?? "",
      }).toString();

      return res.redirect(`/webapp/result?${q}`);
    } catch (err) {
      return res
        .status(500)
        .send(
          errorPage(err.message || "Failed to process transaction result."),
        );
    }
  },
);

module.exports = router;
