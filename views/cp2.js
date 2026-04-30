const { escHtml, safeJson } = require("../services/utils");

function sharedStyles(extra = "") {
  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      :root {
        --bg: #0d0d0d; --surface: #161616; --border: #2a2a2a;
        --accent: #00e5a0; --accent-dim: rgba(0,229,160,0.12);
        --text: #f0f0f0; --muted: #888; --error: #ff5c5c;
        --mono: 'DM Mono', monospace; --sans: 'DM Sans', sans-serif;
      }
      body { background: var(--bg); color: var(--text); font-family: var(--sans);
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; padding: 24px; }
      .card { background: var(--surface); border: 1px solid var(--border);
        border-radius: 16px; padding: 32px 28px; width: 100%; max-width: 380px; text-align: center; }
      .detail-row { display: flex; justify-content: space-between; align-items: center;
        padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
      .detail-row:last-of-type { border-bottom: none; }
      .detail-label { color: var(--muted); }
      .detail-value { font-family: var(--mono); font-weight: 500; color: var(--accent);
        max-width: 58%; text-align: right; word-break: break-word; }
      ${extra}
    </style>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d0d0d;color:#ff5c5c;padding:24px;text-align:center;}</style>
  </head><body><div><h2>Error</h2><p>${escHtml(msg)}</p></div></body></html>`;
}

function loadingPage(txtMtrId, txtAmount, meterInfo = {}) {
  const amtDisplay = Number(txtAmount).toFixed(2);
  const balanceDisplay =
    meterInfo.credit_bal !== undefined && meterInfo.credit_bal !== null
      ? Number(meterInfo.credit_bal).toFixed(2)
      : null;

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EVS (cp2) Payment</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  ${sharedStyles(`
    .logo { width:52px; height:52px; background:var(--accent-dim); border:1.5px solid var(--accent);
      border-radius:14px; display:flex; align-items:center; justify-content:center;
      margin:0 auto 24px; font-size:24px; }
    h1 { font-size:1.25rem; font-weight:700; letter-spacing:-0.02em; margin-bottom:6px; }
    .subtitle { color:var(--muted); font-size:0.85rem; margin-bottom:28px; }
    .spinner-wrap { margin:32px 0 16px; display:flex; flex-direction:column; align-items:center; gap:14px; }
    .spinner { width:36px; height:36px; border:2.5px solid var(--border); border-top-color:var(--accent);
      border-radius:50%; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .status-text { color:var(--muted); font-size:0.82rem; font-family:var(--mono);
      min-height:1.2em; transition:opacity 0.3s; }
    .error-card { background:rgba(255,92,92,0.08); border:1px solid rgba(255,92,92,0.3);
      border-radius:12px; padding:16px; margin-top:20px; font-size:0.83rem; color:var(--error);
      display:none; text-align:left; font-family:var(--mono); line-height:1.5; }
    .retry-btn { margin-top:16px; background:var(--accent); color:#000; border:none;
      border-radius:10px; padding:12px 24px; font-family:var(--sans); font-weight:700;
      font-size:0.9rem; cursor:pointer; display:none; width:100%; }
  `)}
  </head>
  <body>
  <div class="card">
    <div class="logo">⚡</div>
    <h1>Electricity Top-Up</h1>
    <p class="subtitle">Connecting to EVS (cp2) payment gateway…</p>
  
    <div class="detail-row">
      <span class="detail-label">Meter ID</span>
      <span class="detail-value">${escHtml(txtMtrId)}</span>
    </div>
  
      ${
        meterInfo.address
          ? `
    <div class="detail-row">
      <span class="detail-label">Address</span>
      <span class="detail-value">${escHtml(meterInfo.address)}</span>
    </div>`
          : ""
      }
  
    ${
      balanceDisplay !== null
        ? `
    <div class="detail-row">
      <span class="detail-label">Current Balance</span>
      <span class="detail-value">SGD ${escHtml(balanceDisplay)}</span>
    </div>`
        : ""
    }
    
    <div class="detail-row">
      <span class="detail-label">Amount</span>
      <span class="detail-value">SGD ${escHtml(amtDisplay)}</span>
    </div>
  
    <div class="spinner-wrap" id="spinnerWrap">
      <div class="spinner"></div>
      <div class="status-text" id="statusText">Initialising…</div>
    </div>
  
    <div class="error-card" id="errorCard"></div>
<button class="retry-btn" id="retryBtn">Try Again</button>
  </div>
  
  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
  

const METER_ID = ${safeJson(txtMtrId)};
const TXN_AMOUNT = ${safeJson(txtAmount)};
  
    const statusEl = document.getElementById('statusText');
    const errorEl = document.getElementById('errorCard');
    const retryBtn = document.getElementById('retryBtn');
    const spinnerWrap = document.getElementById('spinnerWrap');

    function showError(message) {
  errorEl.textContent = "";
  const strong = document.createElement("strong");
  strong.textContent = "⚠️ Unable to continue";

  const body = document.createElement("div");
  body.textContent = message || "Something went wrong. Please try again.";

  errorEl.appendChild(strong);
  errorEl.appendChild(document.createElement("br"));
  errorEl.appendChild(body);
}
  
    const STAGE_LABELS = {
      init: 'Starting secure session…',
      evs_home: 'Connecting to EVS…',
      login: 'Authenticating meter…',
      select_offer: 'Selecting package…',
      payment_servlet: 'Preparing payment…',
      creditpayment: 'Creating eNETS payment request…',
      enets_paymentlistener: 'Opening payment gateway…',
    };
  
    function setStatus(stage, fallback) {
      statusEl.textContent = STAGE_LABELS[stage] || fallback || 'Processing…';
    }
  
    async function runFlow() {
      errorEl.style.display = 'none';
      retryBtn.style.display = 'none';
      spinnerWrap.style.display = 'flex';
      setStatus('init');
  
      try {
        const resp = await fetch(
          '/webapp/bootstrap?txtMtrId=' + encodeURIComponent(METER_ID) +
          '&txtAmount=' + encodeURIComponent(TXN_AMOUNT),
          { method: 'GET' }
        );
  
        const out = await resp.json().catch(() => ({}));
  
        if (!resp.ok || !out.ok) {
          setStatus(out.stage || 'init', 'Failed');
          throw new Error(out.error || 'Failed to initialise payment flow');
        }
  
        setStatus(out.stage || 'enets_paymentlistener');
  
        if (!out.redirectUrl) {
          throw new Error('Missing redirect URL');
        }
  
        window.location.href = out.redirectUrl;
      } catch (err) {
        spinnerWrap.style.display = 'none';
showError(err.message);
          errorEl.style.display = 'block';
        retryBtn.style.display = 'block';
      }
    }

        document.getElementById('retryBtn').addEventListener('click', runFlow);

  
    runFlow();
  </script>
  </body>
  </html>`;
}

function cardPaymentPage({
  n,
  e,
  netsMid,
  netsTxnRef,
  merchantTxnRef,
  amount,
  meterId,
  address = "",
  balance = "",
  token = "",
}) {
  const amtDisplay = Number(amount || 0).toFixed(2);
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Card Payment</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://www.enets.sg/GW2/js/jsbn.js"></script>
  <script src="https://www.enets.sg/GW2/js/prng4.js"></script>
  <script src="https://www.enets.sg/GW2/js/rng.js"></script>
  <script src="https://www.enets.sg/GW2/js/rsa.js"></script>
  ${sharedStyles(`
    .card { max-width:400px; text-align:left; padding:28px 24px; }
    .logo { width:44px; height:44px; background:var(--accent-dim); border:1.5px solid var(--accent);
      border-radius:12px; display:flex; align-items:center; justify-content:center;
      font-size:20px; margin-bottom:18px; }
    h1 { font-size:1.15rem; font-weight:700; margin-bottom:4px; }
    .sub { color:var(--muted); font-size:0.82rem; margin-bottom:20px; }
    .summary { background:rgba(0,229,160,0.07); border:1px solid rgba(0,229,160,0.18);
      border-radius:10px; padding:10px 14px; margin-bottom:20px;
      font-size:0.85rem; display:flex; justify-content:space-between; }
    .summary .val { font-family:var(--mono); color:var(--accent); font-weight:500; }
    .field { margin-bottom:14px; }
    label { display:block; font-size:11px; color:var(--muted);
      text-transform:uppercase; letter-spacing:0.06em; margin-bottom:5px; }
    input { width:100%; height:40px; background:#111; border:1px solid var(--border);
      border-radius:9px; color:var(--text); font-size:15px; font-family:var(--mono);
      padding:0 12px; outline:none; transition:border-color 0.15s; }
    input:focus { border-color:var(--accent); }
    input.error { border-color:var(--error); }
    .row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
    .btn { width:100%; height:44px; background:var(--accent); color:#000; border:none;
      border-radius:10px; font-family:var(--sans); font-size:1rem; font-weight:700;
      cursor:pointer; margin-top:6px; display:flex; align-items:center; justify-content:center; gap:8px; }
    .btn:disabled { opacity:0.5; cursor:not-allowed; }
    .lock { font-size:11px; color:var(--muted); text-align:center; margin-top:10px; }
    .err-msg { font-size:11px; color:var(--error); margin-top:4px; display:none; }
    #globalError { background:rgba(255,92,92,0.08); border:1px solid rgba(255,92,92,0.3);
      border-radius:10px; padding:12px 14px; font-size:0.83rem; color:var(--error);
      margin-top:14px; display:none; font-family:var(--mono); }
  `)}
    </head>
    <body>
    <div class="card">
      <div class="logo">⚡</div>
      <h1>Card payment</h1>
      <p class="sub">Details are RSA-encrypted before leaving your device.</p>
    
      <div class="summary">
        <span>Meter <span style="font-family:var(--mono)">${escHtml(meterId)}</span></span>
        <span class="val">SGD ${escHtml(amtDisplay)}</span>
      </div>
    
      <form id="payForm" autocomplete="off" onsubmit="return handleSubmit(event)">
    
        <div class="field">
          <label>Cardholder name</label>
          <input type="text" id="cardName" name="cardName"
            placeholder="As printed on card" autocomplete="cc-name"
            style="font-family:var(--sans)">
          <div class="err-msg" id="errName">Required</div>
        </div>
    
        <div class="field">
          <label>Email</label>
          <input type="email" id="cardEmail" name="cardEmail"
            placeholder="you@example.com" autocomplete="email"
            style="font-family:var(--sans)">
          <div class="err-msg" id="errEmail">Valid email required</div>
        </div>
    
        <div class="field">
          <label>Card number</label>
          <input type="tel" id="cardNo" name="cardNo"
            placeholder="•••• •••• •••• ••••" maxlength="19"
            autocomplete="cc-number" inputmode="numeric">
          <div class="err-msg" id="errCard">Enter a valid card number</div>
        </div>
    
        <div class="row3">
          <div class="field" style="grid-column: span 1">
            <label>Month</label>
            <input type="tel" id="expMth" name="expMth"
              placeholder="MM" maxlength="2" inputmode="numeric">
            <div class="err-msg" id="errMth">01–12</div>
          </div>
          <div class="field">
            <label>Year</label>
            <input type="tel" id="expYr" name="expYr"
              placeholder="YY" maxlength="2" inputmode="numeric">
            <div class="err-msg" id="errYr">e.g. 27</div>
          </div>
          <div class="field">
            <label>CVV</label>
            <input type="tel" id="cvv" name="cvv"
              placeholder="•••" maxlength="4" inputmode="numeric">
            <div class="err-msg" id="errCvv">Required</div>
          </div>
        </div>
    
        <!-- Hidden fields posted to eNETS -->
        <input type="hidden" name="enc" id="enc">
        <input type="hidden" name="netsMid" value="${escHtml(netsMid)}">
        <input type="hidden" name="netsTxnRef" value="${escHtml(netsTxnRef)}">
        <input type="hidden" name="token" value="${escHtml(token)}">

        <button type="submit" class="btn" id="submitBtn">
          <span id="btnLabel">Pay SGD ${escHtml(amtDisplay)}</span>
        </button>
        <p class="lock">🔒 eNETS RSA-encrypted · Powered by eNETS</p>
        <div id="globalError"></div>
      </form>
    </div>
    
    <script>
      const tg = window.Telegram?.WebApp;
      if (tg) { tg.ready(); tg.expand(); }
  
      const RSA_N = ${safeJson(n)};
      const RSA_E = ${safeJson(e)};
      const MERCHANT_TXN_REF = ${safeJson(merchantTxnRef)};  
      // Replicate eNETS linebrk(str, maxLen)
      function linebrk(str, maxLen) {
        let out = '';
        let i = 0;
        while (i + maxLen < str.length) {
          out += str.substring(i, i + maxLen) + '\\n';
          i += maxLen;
        }
        return out + str.substring(i);
      }
  
      function autoBackspace(currentId, prevId) {
    const el = document.getElementById(currentId);
    const prev = document.getElementById(prevId);
  
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !this.value) {
        prev?.focus();
  
        // optional: move cursor to end
        const len = prev?.value?.length ?? 0;
        prev?.setSelectionRange?.(len, len);
      }
    });
  }
  
      function autoNext(currentId, nextId, maxLen) {
      const el = document.getElementById(currentId);
      const next = document.getElementById(nextId);
    
      el.addEventListener('input', function () {
        const value = this.value.replace(/\D/g, '');
        if (value.length >= maxLen) {
          next?.focus();
        }
      });
    }
      
      function show(id) { document.getElementById(id).style.display = 'block'; }
      function hide(id) { document.getElementById(id).style.display = 'none'; }
      function setError(inputId, errId, msg) {
        const el = document.getElementById(inputId);
        el.classList.add('error');
        const em = document.getElementById(errId);
        em.textContent = msg || em.textContent;
        em.style.display = 'block';
        return false;
      }
      function clearError(inputId, errId) {
        document.getElementById(inputId).classList.remove('error');
        hide(errId);
      }
    
      function validate() {
        let ok = true;
        clearError('cardName','errName');
        clearError('cardEmail','errEmail');
        clearError('cardNo','errCard');
        clearError('expMth','errMth');
        clearError('expYr','errYr');
        clearError('cvv','errCvv');
    
        const name  = document.getElementById('cardName').value.trim();
        const email = document.getElementById('cardEmail').value.trim();
        const card  = document.getElementById('cardNo').value.replace(/\\s/g,'');
        const mth   = document.getElementById('expMth').value.trim();
        const yr    = document.getElementById('expYr').value.trim();
        const cvv   = document.getElementById('cvv').value.trim();
    
        if (!name) { setError('cardName','errName','Required'); ok = false; }
        if (!email || !/^[^@]+@[^@]+\\.[^@]+$/.test(email)) {
          setError('cardEmail','errEmail','Valid email required'); ok = false; }
        if (!card || card.length < 13 || card.length > 19 || !/^\\d+$/.test(card)) {
          setError('cardNo','errCard','Enter a valid card number'); ok = false; }
        const m = parseInt(mth, 10);
        if (!mth || isNaN(m) || m < 1 || m > 12) {
          setError('expMth','errMth','01–12'); ok = false; }
        if (!yr || yr.length !== 2 || !/^\\d{2}$/.test(yr)) {
          setError('expYr','errYr','2-digit year'); ok = false; }
        if (!cvv || cvv.length < 3 || !/^\\d+$/.test(cvv)) {
          setError('cvv','errCvv','3–4 digits'); ok = false; }
    
        return ok ? { name, email, card, mth: mth.padStart(2,'0'), yr, cvv } : null;
      }
    
      async function handleSubmit(e) {
        e.preventDefault();
        hide('globalError');
    
        const fields = validate();
        if (!fields) return false;
    
        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        document.getElementById('btnLabel').textContent = 'Encrypting…';
    
        try {
         var rsa = new RSAKey();
      rsa.setPublic(RSA_N, RSA_E);
  
      var thetext = "cardNo=" + fields.card + ",cvv=" + fields.cvv;
      var res = rsa.encrypt(thetext);
  
      if (!res) {
        throw new Error('RSA encryption failed');
      }
  
      var enc = "RSA" + linebrk(res, 2048);
  const token = document.querySelector('input[name=token]').value;

  const payload = new URLSearchParams({
    browserJavaEnabled: 'false',
    browserJavaScriptEnabled: 'true',
    browserLanguage: navigator.language || 'en-US',
    browserColorDepth: String(screen.colorDepth || 24),
    browserScreenHeight: String(screen.height),
    browserScreenWidth: String(screen.width),
    browserTz: String(-(new Date().getTimezoneOffset())),
    browserUserAgent: navigator.userAgent,
    enc: enc,
    pageId: 'payment_page',
    button: 'submit',
    e: ${safeJson(e)},
    n: ${safeJson(n)},
    netsMid: ${safeJson(netsMid)},
    netsTxnRef: ${safeJson(netsTxnRef)},
    merchantTxnRef: MERCHANT_TXN_REF,
    currencyCode: 'SGD',
    txnAmount: String(Math.round(${safeJson(Number(amount))} * 100)),
    name: fields.name,
    cardNo: '****************',
    cvv: '***',
    expiryMonth: fields.mth,
    expiryYear: '20' + fields.yr,
    consumerEmail: fields.email,
    agree: 'Y',
    "meterId": ${safeJson(meterId)},
    "address": ${safeJson(address)},
    "balance": ${safeJson(balance)},
    "amount": ${safeJson("S$ " + amtDisplay)},
    token,
  });
  
  const result = await fetch('/webapp/enets_pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  
  const out = await result.json().catch(() => ({}));
  
  if (!result.ok || !out.ok) {
    throw new Error(out.error || 'Payment request failed');
  }
  
window.location.href = '/webapp/result?token=' + encodeURIComponent(token);
    
        } catch (err) {
          btn.disabled = false;
          document.getElementById('btnLabel').textContent = 'Pay SGD ${escHtml(amtDisplay)}';
          const ge = document.getElementById('globalError');
          ge.textContent = '⚠️ ' + (err.message || 'Encryption error');
          ge.style.display = 'block';
        }
    
        return false;
      }
    
      document.getElementById('cardNo').addEventListener('input', function() {
        let v = this.value.replace(/\\D/g,'').substring(0,16);
        this.value = v.replace(/(\\d{4})(?=\\d)/g,'$1 ');
      });
  
      
  // Auto jump between fields
  autoNext('expMth', 'expYr', 2);
  autoNext('expYr', 'cvv', 2);
  
  autoBackspace('expYr', 'expMth');
  autoBackspace('cvv', 'expYr');
    </script>
    </body>
    </html>`;
}

function renderFinalResultPage(parsed) {
  const ok = parsed.status === "success";

  const logoBg = ok ? "var(--accent-dim)" : "rgba(255,92,92,0.12)";
  const logoBorder = ok ? "var(--accent)" : "var(--error)";
  const valueColor = ok ? "var(--accent)" : "var(--text)";
  const noteBg = ok ? "rgba(0,229,160,0.08)" : "rgba(255,92,92,0.08)";
  const noteBorder = ok ? "rgba(0,229,160,0.22)" : "rgba(255,92,92,0.25)";
  const noteColor = ok ? "var(--accent)" : "var(--error)";
  const btnBg = ok ? "var(--accent)" : "#2a2a2a";
  const btnColor = ok ? "#000" : "#fff";

  const title = ok ? "Top-Up Successful" : "Top-Up Failed";
  const reason = parsed.reason || "Unable to determine transaction outcome.";
  const topUpUrl = `/webapp?txtMtrId=${encodeURIComponent(parsed.meterId || "")}&txtAmount=${encodeURIComponent((parsed.amount || "").replace(/[^0-9.]/g, ""))}`;

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escHtml(title)}</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    ${sharedStyles(`
      .logo { width:52px; height:52px; background:${logoBg}; border:1.5px solid ${logoBorder};
        border-radius:14px; display:flex; align-items:center; justify-content:center;
        margin:0 auto 24px; font-size:24px; }
      h1 { margin:0 0 8px; font-size:1.25rem; }
      .subtitle { color:var(--muted); font-size:0.9rem; margin-bottom:24px; }
      .detail-value { color:${valueColor}; }
      .status-note { margin-top:22px; padding:14px; border-radius:12px; font-size:0.9rem;
        background:${noteBg}; border:1px solid ${noteBorder}; color:${noteColor}; }
      .actions { margin-top:20px; display:grid; gap:10px; }
      .btn { width:100%; border:none; border-radius:10px; padding:12px 16px;
        font-family:var(--sans); font-size:0.95rem; font-weight:700; cursor:pointer;
        background:${btnBg}; color:${btnColor}; }
      .btn.secondary { background:#242424; color:#fff; }
    `)}
  </head>
    <body>
      <div class="card">
        <div class="logo">${ok ? "✅" : "⚠️"}</div>
        <h1>${escHtml(title)}</h1>
        <div class="subtitle">${ok ? "Your transaction has been processed." : "Your transaction was not completed."}</div>
    
        <div class="detail-row">
          <span class="detail-label">Reference</span>
          <span class="detail-value">${escHtml(parsed.merchantTxnRef || "-")}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Meter ID</span>
          <span class="detail-value">${escHtml(parsed.meterId || "-")}</span>
        </div>
        ${
          parsed.address
            ? `
        <div class="detail-row">
          <span class="detail-label">Address</span>
          <span class="detail-value">${escHtml(parsed.address)}</span>
        </div>`
            : ""
        }
        ${
          parsed.balance !== undefined &&
          parsed.balance !== null &&
          parsed.balance !== ""
            ? `
        <div class="detail-row">
          <span class="detail-label">Balance</span>
          <span class="detail-value">SGD ${escHtml(Number(parsed.balance).toFixed(2))}</span>
        </div>`
            : ""
        }
        ${
          parsed.amount !== undefined &&
          parsed.amount !== null &&
          parsed.amount !== ""
            ? `<div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">SGD ${escHtml(Number(String(parsed.amount).replace(/[^0-9.]/g, "")).toFixed(2))}</span></div>`
            : `<div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">-</span></div>`
        }
    
        <div class="status-note">${escHtml(reason)}</div>
    
        <div class="actions">
<button class="btn" id="topUpAgainBtn" data-url="${escHtml(topUpUrl)}">Top Up Again</button>
<button class="btn secondary" id="closeBtn">Close</button>
        </div>
      </div>
    
    <script>
      const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  function closeMiniApp() {
    if (tg) {
      const payload = JSON.stringify({
        status: ${safeJson(parsed.status)},
        merchantTxnRef: ${safeJson(parsed.merchantTxnRef || "")},
        meterId: ${safeJson(parsed.meterId || "")},
        amount: ${safeJson(parsed.amount || "")},
        address: ${safeJson(parsed.address || "")},
        balance: ${safeJson(parsed.balance || "")},
        reason: ${safeJson(parsed.reason || "")},
      });
      tg.sendData(payload);
      tg.close();
    }
  }

      document.getElementById('closeBtn').addEventListener('click', closeMiniApp);
        document.getElementById('topUpAgainBtn').addEventListener('click', function() {
    window.location.href = this.dataset.url;
  });
    </script>
    </body>
    </html>`;
}

module.exports = {
  errorPage,
  loadingPage,
  cardPaymentPage,
  renderFinalResultPage,
};
