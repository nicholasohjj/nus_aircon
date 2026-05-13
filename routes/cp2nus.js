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
const { errorPage } = require("../views/errorPage");
const {
  fetchEnvJsp,
  fetchReceipt,
  runBootstrap,
  callCreditInit,
  submitPanForm,
  postToB2s,
} = require("../services/cp2nusService");
const { bot } = require("../bot");

router.use(express.urlencoded({ extended: false }));
router.use(express.json());

router.get("/webapp", async (req, res) => {
  const { txtMtrId, txtAmount, chatId } = req.query;
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

    const qs = new URLSearchParams({
      txtMtrId,
      txtAmount,
      chatId: chatId || "",
      address: meterSummary.address || "",
      balance: String(meterSummary.credit_bal ?? ""),
    }).toString();

    return res.redirect(`/app/cp2nus/loading?${qs}`);
  } catch {
    const qs = new URLSearchParams({
      txtMtrId,
      txtAmount,
      chatId: chatId || "",
    }).toString();
    return res.redirect(`/app/cp2nus/loading?${qs}`);
  }
});

// ── Bootstrap: runs all steps, returns redirect URL to /webapp/pay ─────────────

router.get("/webapp/session", (req, res) => {
  const session = getPaymentSession(req.query.token);
  if (!session)
    return res.status(400).json({ ok: false, error: "Session expired." });
  const {
    txtMtrId,
    txtAmount,
    address,
    balance,
    nets,
    status,
    reason,
    merchantTxnRef,
    source,
  } = session;
  return res.json({
    ok: true,
    txtMtrId,
    txtAmount,
    address,
    balance,
    status,
    reason: reason || "",
    merchantTxnRef: merchantTxnRef || "",
    source: source || "",
    ...nets,
  });
});

router.get("/webapp/bootstrap", async (req, res) => {
  const { txtMtrId, txtAmount, chatId } = req.query;

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
      chatId: chatId || null,
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

  return res.redirect(`/app/cp2nus/pay?token=${encodeURIComponent(token)}`);
});

router.get("/webapp/receipt", (req, res) => {
  const { token } = req.query;
  const session = getPaymentSession(token);
  if (!session?.receiptPdf) {
    return res.status(404).json({ ok: false, error: "Receipt not available." });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="receipt.pdf"');
  return res.send(session.receiptPdf);
});

router.post("/webapp/notify", express.json(), async (req, res) => {
  try {
    const { token } = req.body;
    const session = getPaymentSession(token);
    if (!session || !session.chatId) return res.json({ ok: true });

    const {
      status,
      merchantTxnRef,
      txtMtrId,
      txtAmount,
      reason,
      address,
      balance,
    } = session;
    const ok = status === "success";
    const lines = [
      ok ? "✅ *Top-Up Successful*" : "⚠️ *Top-Up Failed*",
      "",
      `🔌 Meter ID: \`${txtMtrId || "-"}\``,
    ];
    if (address) lines.push(`🏠 Address: ${address}`);
    if (txtAmount) lines.push(`💵 Amount: SGD ${Number(txtAmount).toFixed(2)}`);
    if (balance !== "" && balance != null)
      lines.push(`💰 New Balance: SGD ${Number(balance).toFixed(2)}`);
    if (merchantTxnRef) lines.push(`🧾 Reference: \`${merchantTxnRef}\``);
    if (!ok && reason) lines.push(`\n❌ Reason: ${reason}`);

    await bot.telegram.sendMessage(session.chatId, lines.join("\n"), {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("notify error", err);
  }
  res.json({ ok: true });
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
      session = getPaymentSession(token);
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

      const debug = req.body.debug === "1";

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

      if (debug && panResult.preParsed) {
        panResult.preParsed.status = "success";
        panResult.preParsed.reason = "Payment completed.";
      }

      if (panResult.preParsed) {
        const normalized = normalizeFinalOutcome(panResult.preParsed);

        session.status = normalized.status;
        session.merchantTxnRef = normalized.merchantTxnRef || merchantTxnRef;
        session.reason = normalized.reason || "";
        session.source = "pan_result";
        session.completedAt = Date.now();

        track(
          normalized.status === "success"
            ? "payment_completed"
            : "payment_failed",
          {
            meterId,
            amount,
            merchantTxnRef: normalized.merchantTxnRef || merchantTxnRef || "",
            status: normalized.status,
            reason: normalized.reason || "",
            route: "cp2nus",
            source: "pan_result",
          },
        );

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

      if (b2sResult.parsed?.status === "success") {
        const pdfBuffer = await fetchReceipt(jsessionId, b2sResult.finalUrl);
        if (pdfBuffer) session.receiptPdf = pdfBuffer;
      }

      const parsed = b2sResult.parsed || {};
      const normalized = normalizeFinalOutcome(parsed);
      const finalAmount = parsed.amount || amount || "";

      if (debug) {
        normalized.status = "success";
        normalized.reason = "Payment completed.";
      }

      session.status = normalized.status;
      session.merchantTxnRef = normalized.merchantTxnRef || merchantTxnRef;
      session.source = "pay_result";
      session.completedAt = Date.now();

      track(
        normalized.status === "success"
          ? "payment_completed"
          : "payment_failed",
        {
          meterId: normalized.meterId || meterId || "",
          amount: finalAmount,
          merchantTxnRef: normalized.merchantTxnRef || merchantTxnRef || "",
          status: normalized.status,
          reason: normalized.reason || "",
          route: "cp2nus",
          source: "pay_result",
        },
      );

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

  if (!token) {
    return res.status(400).send(errorPage("Missing result token."));
  }

  const session = getPaymentSession(token);
  if (!session) {
    return res
      .status(400)
      .send(
        errorPage(
          "Session expired. Check your meter balance to confirm payment.",
        ),
      );
  }

  return res.redirect(`/app/cp2nus/result?token=${encodeURIComponent(token)}`);
});

module.exports = router;
