require("dotenv").config();
const express = require("express");
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { getMeterSummary } = require("../services/ore");
const { track, captureException } = require("../services/analytics");
const { validationError } = require("../services/validators");
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
const {
  createPaymentSession,
  getPaymentSession,
} = require("../services/paymentSession");
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
  const { token } = req.query;

  // Token path (new)
  if (token) {
    const session = getPaymentSession(token);
    if (!session)
      return res
        .status(400)
        .send(
          errorPage(
            "Session expired. Check your meter balance to confirm payment.",
          ),
        );

    const {
      status,
      merchantTxnRef,
      txtMtrId,
      txtAmount,
      reason,
      address,
      balance,
    } = session;

    const eventName =
      status === "success" ? "payment_completed" : "payment_failed";
    track(eventName, {
      meterId: txtMtrId,
      amount: txtAmount,
      status,
      merchantTxnRef,
      reason: reason || null,
    });

    res.setHeader("Content-Type", "text/html; charset=UTF-8");

    return res.send(
      renderFinalResultPage({
        status,
        merchantTxnRef,
        meterId: txtMtrId,
        amount: txtAmount,
        reason,
        address,
        balance,
      }),
    );
  }

  const {
    status = "unknown",
    ref = "",
    meterId = "",
    amount = "",
    reason = "",
    address = "",
    balance = "",
  } = req.query;

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

  const inputError = validationError({ txtMtrId, txtAmount });

  if (inputError) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      code: "INVALID_INPUT",
      error: inputError,
    });
  }

  try {
    const [out, meterSummary] = await Promise.all([
      runPurchaseFlow({ txtMtrId, txtAmount }),
      getMeterSummary(txtMtrId),
    ]);

    track("bootstrap_started", { meterId: txtMtrId, amount: txtAmount });

    if (!out?.ok) {
      const error =
        out.loginResult === "invalid"
          ? "Meter ID not found. Please check that you selected the correct hostel and entered the 8-digit meter ID correctly."
          : out.stage === "select_offer"
            ? "Invalid amount. Please enter an amount between $6.00 and $50.00."
            : out.error ||
              "Failed to initialise payment flow. Please try again.";

      track("bootstrap_failed", {
        meterId: txtMtrId,
        amount: txtAmount,
        stage: out.stage,
        error,
      });

      return res.status(502).json({
        ...out,
        error,
      });
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

    const token = createPaymentSession({
      txtMtrId,
      txtAmount,
      address: meterSummary.address || "",
      balance: String(meterSummary.credit_bal ?? ""),
      nets: { n, e, netsMid, netsTxnRef, merchantTxnRef, actionUrl },
      status: "pending",
    });

    return res.status(200).json({
      ok: true,
      stage: out.stage,
      redirectUrl: `/webapp/pay?token=${token}`,
    });
  } catch (err) {
    captureException(err, String(txtMtrId || "anonymous"), {
      route: "cp2",
      endpoint: "/webapp/bootstrap",
    });
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
      const { token } = req.body;
      const session = getPaymentSession(token);
      if (!session) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid or expired payment session." });
      }

      const {
        txtMtrId: meterId,
        txtAmount: amount,
        address,
        balance,
      } = session; // ← add this here
      const body = new URLSearchParams(req.body).toString();

      track("payment_attempted", {
        meterId,
        amount,
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

        session.status = normalized.status;
        session.merchantTxnRef =
          normalized.merchantTxnRef || req.body.merchantTxnRef || "";
        session.reason = normalized.reason || "";
        session.completedAt = Date.now();

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
          meterId: meterId || normalized.meterId || "",
          address: address || "",
          balance: balance || "",
          amount: amount || normalized.amount || "",
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

      const normalized = normalizeFinalOutcome(receipt); // add this

      session.status = normalized.status;
      session.merchantTxnRef =
        receipt.merchantTxnRef || req.body.merchantTxnRef || "";
      session.reason = normalized.reason || "";
      session.completedAt = Date.now();

      return res.status(200).json({
        ok: true,
        source: "enets_receipt_fallback",
        status: normalized.status,
        merchantTxnRef: session.merchantTxnRef,
        meterId,
        address, // from session
        balance, // from session
        amount,
        reason: normalized.reason || "",
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
  const { token } = req.query;
  if (!token) return res.status(400).send(errorPage("Missing payment token."));

  const session = getPaymentSession(token);
  if (!session)
    return res
      .status(400)
      .send(
        errorPage("Payment session expired or invalid. Please start again."),
      );

  const { txtMtrId, txtAmount, address, balance, nets } = session;
  const { n, e, netsMid, netsTxnRef, merchantTxnRef, actionUrl } = nets;

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
      token,
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

  const inputError = validationError({ txtMtrId, txtAmount });

  if (inputError) {
    return res.status(400).send(errorPage(inputError));
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
      const { status = "0", id, token } = req.query;
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
      const session = token ? getPaymentSession(token) : null;

      if (session) {
        session.status = parsed.status || "unknown";
        session.merchantTxnRef = parsed.merchantTxnRef || "";
        session.reason = parsed.reason || "";
        session.completedAt = Date.now();
        return res.redirect(`/webapp/result?token=${token}`);
      }

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
