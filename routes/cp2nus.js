require("dotenv").config();
const express = require("express");
const router = express.Router();
const { getMeterSummary } = require("../services/ore");
const { track, captureException } = require("../services/analytics");
const { isValidMeterId, isValidAmount } = require("../services/validators");
const { normalizeFinalOutcome } = require("../services/utils");
const {
  createPaymentSession,
  getPaymentSession,
} = require("../services/paymentSession");
const { DEFAULT_HEADERS, CP2NUS_BASE_PATH } = require("../services/config");
const {
  errorPage,
  loadingPage,
  cardPaymentPage,
  renderFinalResultPage,
} = require("../views/cp2nus");
const {
  fetchEnvJsp,
  runBootstrap,
  callCreditInit,
  submitPanForm,
  postToB2s,
} = require("../services/cp2nusService");
router.use(express.urlencoded({ extended: false }));
router.use(express.json());

router.get("/webapp", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;
  if (!txtMtrId || !txtAmount)
    return res.status(400).send(errorPage("Missing meter ID or amount."));

  if (!isValidMeterId(txtMtrId))
    return res
      .status(400)
      .send(errorPage("Meter ID must be exactly 8 digits."));

  if (!isValidAmount(txtAmount))
    return res
      .status(400)
      .send(errorPage("Amount must be between $6.00 and $50.00."));

  try {
    const meterSummary = await getMeterSummary(txtMtrId);
    track("webapp_opened", {
      meterId: txtMtrId,
      amount: txtAmount,
      route: "cp2nus",
      ua: req.get("user-agent"),
    });
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.send(
      loadingPage(txtMtrId, txtAmount, meterSummary, CP2NUS_BASE_PATH),
    );
  } catch {
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.send(loadingPage(txtMtrId, txtAmount, {}, CP2NUS_BASE_PATH));
  }
});

// ── Bootstrap: runs all steps, returns redirect URL to /webapp/pay ─────────────

router.get("/webapp/bootstrap", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing meter ID or amount." });
  }

  if (!isValidMeterId(txtMtrId)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_METER_ID",
      error: "Meter ID must be exactly 8 digits.",
    });
  }

  if (!isValidAmount(txtAmount)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_AMOUNT",
      error: "Amount must be between $6.00 and $50.00.",
    });
  }

  track("bootstrap_started", { meterId: txtMtrId, amount: txtAmount });

  try {
    const boot = await runBootstrap({ txtMtrId, txtAmount });

    if (!boot.ok) {
      track("bootstrap_failed", {
        meterId: txtMtrId,
        amount: txtAmount,
        stage: boot.stage || "unknown",
        error: boot.error || null,
      });
      return res.status(500).json(boot);
    }

    track("bootstrap_succeeded", { meterId: txtMtrId, amount: txtAmount });

    const token = createPaymentSession({
      txtMtrId,
      txtAmount,
      address: boot.meta.address || "",
      balance: String(boot.meta.balance ?? ""),
      nets: boot.nets,
      status: "pending", // authoritative status lives here
    });

    return res.status(200).json({
      ok: true,
      redirectUrl: `${CP2NUS_BASE_PATH}/webapp/pay?token=${token}`,
    });
  } catch (err) {
    captureException(err, String(txtMtrId || "anonymous"), {
      route: "cp2nus",
      endpoint: CP2NUS_BASE_PATH + "/webapp/bootstrap",
    });
    track("bootstrap_failed", {
      meterId: txtMtrId,
      amount: txtAmount,
      stage: err.stage || "unknown",
      error: err.error || err.message,
    });
    return res.status(500).json({
      ok: false,
      stage: err.stage || "unknown",
      step1Status: err.step1Status,
      step2Status: err.step2Status,
      step3Status: err.step3Status,
      error: err.error || err.message,
    });
  }
});

// ── Card payment page ─────────────────────────────────────────────────────────

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
  const {
    rsaModulus,
    rsaExponent,
    netsTxnRef,
    merchantTxnRef,
    txnRand,
    keyId,
    hmac,
    paymtNetsMid,
    netsMid,
  } = nets;

  if (!rsaModulus || !rsaExponent) {
    return res
      .status(500)
      .send(errorPage("Payment gateway did not return a valid RSA key."));
  }

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  return res.send(
    cardPaymentPage({
      n: rsaModulus,
      e: rsaExponent,
      netsMid: paymtNetsMid || netsMid,
      netsTxnRef,
      merchantTxnRef: merchantTxnRef || "",
      amount: txtAmount,
      meterId: txtMtrId,
      address,
      balance,
      txnRand,
      keyId,
      hmac,
      basePath: CP2NUS_BASE_PATH,
      token,
    }),
  );
});

// ── eNETS pay proxy ───────────────────────────────────────────────────────────

router.post(
  "/webapp/enets_pay",
  express.urlencoded({ extended: false, limit: "10mb" }),
  async (req, res) => {
    let session = null;

    try {
      const {
        enc,
        netsMid,
        netsTxnRef,
        merchantTxnRef,
        txnRand,
        name,
        expiryMonth,
        expiryYear,
        consumerEmail,
        imgPayMode,
        browserJavaEnabled,
        browserLanguage,
        browserColorDepth,
        browserScreenHeight,
        browserScreenWidth,
        browserTz,
        browserUserAgent,
        keyId: reqKeyId,
        hmac: reqHmac,
      } = req.body;

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
      } = session;

      if (!enc || !netsMid || !merchantTxnRef) {
        return res.status(400).json({
          ok: false,
          error: "Missing required fields (enc, netsMid, merchantTxnRef)",
        });
      }

      track("payment_attempted", {
        meterId,
        amount,
        merchantTxnRef,
        route: "cp2nus",
      });

      const browserInfo = {
        javaEnabled: browserJavaEnabled || "false",
        language: browserLanguage || "en-US",
        colorDepth: browserColorDepth || "24",
        screenHeight: browserScreenHeight || "963",
        screenWidth: browserScreenWidth || "1920",
        tz: browserTz || "-480",
        userAgent: browserUserAgent || DEFAULT_HEADERS["User-Agent"],
      };

      const envJsessionId = await fetchEnvJsp();

      // Step 4a: establish credit session
      const { jsessionId } = await callCreditInit({
        txnRand: txnRand || "",
        keyId: reqKeyId || "",
        hmac: reqHmac || "",
        jsessionId: envJsessionId, // ← seed with env.jsp session
      });

      // Step 4b: submit RSA-encrypted card data
      // expiryYear arrives as 4-digit string ("2027") — pass through as-is
      const panResult = await submitPanForm({
        jsessionId,
        txnRand: txnRand || "",
        netsMid,
        netsTxnRef: netsTxnRef || "",
        merchantTxnRef,
        enc: (enc || "").replace(/[\r\n]/g, ""),
        name: name || "",
        expiryMonth: expiryMonth || "",
        expiryYear: expiryYear || "",
        consumerEmail: consumerEmail || "",
        imgPayMode: imgPayMode || "on",
        browserInfo,
      });

      if (panResult.preParsed) {
        const normalized = normalizeFinalOutcome(panResult.preParsed);

        session.status = normalized.status;
        session.merchantTxnRef = normalized.merchantTxnRef || merchantTxnRef;
        session.completedAt = Date.now();
        return res.status(200).json({
          ok: true,
          source: "pan_result",
          status: normalized.status,
          merchantTxnRef: normalized.merchantTxnRef || merchantTxnRef || "",
          meterId: meterId || "",
          address: address || "",
          balance: balance || "",
          amount: amount || "",
          reason: normalized.reason,
          stageRespCode: panResult.preParsed.stageRespCode || "",
        });
      }

      // Step 4c: POST auto-submit form to b2s, follow redirect to /pay_result
      const b2sResult = await postToB2s({
        action: panResult.action,
        message: panResult.message,
        hmac: panResult.hmac,
        keyId: panResult.keyId,
        jsessionId,
      });

      const parsed = b2sResult.parsed || {};
      const normalized = normalizeFinalOutcome(parsed);
      const finalAmount = parsed.amount || amount || "";

      session.status = normalized.status;
      session.merchantTxnRef = normalized.merchantTxnRef || merchantTxnRef;
      session.completedAt = Date.now();

      return res.status(200).json({
        ok: true,
        source: "pay_result",
        status: normalized.status,
        merchantTxnRef: normalized.merchantTxnRef || merchantTxnRef || "",
        meterId: normalized.meterId || meterId || "",
        address: address || "",
        balance: balance || "",
        amount: finalAmount,
        reason: normalized.reason,
        stageRespCode: parsed.stageRespCode || "",
        upstreamStatus: { b2s: b2sResult.status, finalUrl: b2sResult.finalUrl },
      });
    } catch (err) {
      const meterId = session?.txtMtrId;
      captureException(
        err,
        String(meterId || req.body?.meterId || "anonymous"),
        {
          route: "cp2nus",
          merchantTxnRef: req.body?.merchantTxnRef || "",
        },
      );
      return res.status(500).json({ ok: false, error: err.message });
    }
  },
);

// ── Result page ───────────────────────────────────────────────────────────────

router.get("/webapp/result", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(errorPage("Missing result token."));

  const session = getPaymentSession(token);
  if (!session)
    return res
      .status(400)
      .send(
        errorPage(
          "Session expired. Check your meter balance to confirm payment.",
        ),
      );

  // All values come from server-side session, not query params:
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
    renderFinalResultPage(
      {
        status,
        merchantTxnRef,
        meterId: txtMtrId,
        amount: txtAmount,
        reason,
        address,
        balance,
      },
      CP2NUS_BASE_PATH,
    ),
  );
});

module.exports = router;
