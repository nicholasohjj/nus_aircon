const { escHtml, safeJson } = require("../services/utils");
const { CP2NUS_BASE_PATH } = require("../services/config");
const { htmlHead, errorPage, telegramInit } = require("./shared");

function loadingPage(
  txtMtrId,
  txtAmount,
  meterInfo = {},
  basePath = CP2NUS_BASE_PATH,
) {
  const amtDisplay = Number(txtAmount).toFixed(2);
  const balanceDisplay =
    meterInfo.credit_bal !== undefined && meterInfo.credit_bal !== null
      ? Number(meterInfo.credit_bal).toFixed(2)
      : null;

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
  ${htmlHead({
    title: "EVS (cp2nus) Payment",
    extra: `
    .logo { width:52px; height:52px; background:var(--accent-dim); border:1.5px solid var(--accent);
      border-radius:14px; display:flex; align-items:center; justify-content:center;
      margin:0 auto 24px; font-size:24px; }
    h1 { font-size:1.25rem; font-weight:700; letter-spacing:-0.02em; margin-bottom:6px; }
    .subtitle { color:var(--muted); font-size:0.85rem; margin-bottom:28px; }
    .spinner-wrap { margin:32px 0 16px; display:flex; flex-direction:column; align-items:center; gap:14px; }
    .spinner { width:36px; height:36px; border:2.5px solid var(--border);
      border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .status-text { color:var(--muted); font-size:0.82rem; font-family:var(--mono); min-height:1.2em; }
    .error-card { background:rgba(255,92,92,0.08); border:1px solid rgba(255,92,92,0.3);
      border-radius:12px; padding:16px; margin-top:20px; font-size:0.83rem; color:var(--error);
      display:none; text-align:left; font-family:var(--mono); line-height:1.5; }
    .retry-btn { margin-top:16px; background:var(--accent); color:#000; border:none;
      border-radius:10px; padding:12px 24px; font-family:var(--sans); font-weight:700;
      font-size:0.9rem; cursor:pointer; display:none; width:100%; }
  `,
  })}
  </head>
  <body>
  <div class="card">
    <div class="logo">⚡</div>
    <h1>Electricity Top-Up</h1>
    <p class="subtitle">Connecting to EVS (cp2nus) payment gateway…</p>
  
    <div class="detail-row">
      <span class="detail-label">Meter ID</span>
      <span class="detail-value">${escHtml(txtMtrId)}</span>
    </div>
    ${meterInfo.address ? `<div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${escHtml(meterInfo.address)}</span></div>` : ""}
    ${balanceDisplay !== null ? `<div class="detail-row"><span class="detail-label">Current Balance</span><span class="detail-value">SGD ${escHtml(balanceDisplay)}</span></div>` : ""}
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
    ${telegramInit()}
    const METER_ID   = ${safeJson(txtMtrId)};
    const TXN_AMOUNT = ${safeJson(txtAmount)};
    const BASE_PATH  = ${safeJson(basePath)};
  
    async function runFlow() {
      document.getElementById('errorCard').style.display   = 'none';
      document.getElementById('retryBtn').style.display    = 'none';
      document.getElementById('spinnerWrap').style.display = 'flex';
      document.getElementById('statusText').textContent    = 'Initialising…';
  
      try {
        document.getElementById('statusText').textContent = 'Creating transaction…';
  
const resp = await fetch('${escHtml(basePath)}/webapp/bootstrap?txtMtrId=' + encodeURIComponent(METER_ID) +
          '&txtAmount=' + encodeURIComponent(TXN_AMOUNT)
        );
        const out = await resp.json().catch(() => ({}));
  
        if (!resp.ok || !out.ok) throw new Error(out.error || 'Failed to initialise payment');
        if (!out.redirectUrl)    throw new Error('Missing redirect URL from bootstrap');
  
        window.location.href = out.redirectUrl;
      } catch (err) {
        document.getElementById('spinnerWrap').style.display = 'none';
        const ec = document.getElementById('errorCard');
        ec.textContent   = '⚠️ ' + (err.message || 'Unknown error');
        ec.style.display = 'block';
        document.getElementById('retryBtn').style.display = 'block';
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
  txnRand = "",
  keyId = "",
  hmac = "",
  basePath = CP2NUS_BASE_PATH,
  token = "",
}) {
  const amtDisplay = Number(amount || 0).toFixed(2);

  const ENETS_SCRIPTS = [
    "https://www.enets.sg/GW2/js/jsbn.js",
    "https://www.enets.sg/GW2/js/prng4.js",
    "https://www.enets.sg/GW2/js/rng.js",
    "https://www.enets.sg/GW2/js/rsa.js",
  ];

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
  ${htmlHead({
    title: "Card Payment",
    extraScripts: ENETS_SCRIPTS,
    extra: `
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
  `,
  })}
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
<label for="cardName">Cardholder name</label>
        <input type="text" id="cardName" placeholder="As printed on card" autocomplete="cc-name" style="font-family:var(--sans)">
        <div class="err-msg" id="errName">Required</div>
      </div>
      <div class="field">
<label for="cardEmail">Email</label>
        <input type="email" id="cardEmail" placeholder="you@example.com" autocomplete="email" style="font-family:var(--sans)">
        <div class="err-msg" id="errEmail">Valid email required</div>
      </div>
      <div class="field">
<label for="cardNo">Card number</label>
        <input type="tel" id="cardNo" placeholder="•••• •••• •••• ••••" maxlength="19" autocomplete="cc-number" inputmode="numeric">
        <div class="err-msg" id="errCard">Enter a valid card number</div>
      </div>
      <div class="row3">
        <div class="field">
<label for="expMth">Month</label>
          <input type="tel" id="expMth" placeholder="MM" maxlength="2" inputmode="numeric">
          <div class="err-msg" id="errMth">01–12</div>
        </div>
        <div class="field">
<label for="expYr">Year</label>
          <input type="tel" id="expYr" placeholder="YY" maxlength="2" inputmode="numeric">
          <div class="err-msg" id="errYr">e.g. 27</div>
        </div>
        <div class="field">
<label for="cvv">CVV</label>
          <input type="tel" id="cvv" placeholder="•••" maxlength="4" inputmode="numeric">
          <div class="err-msg" id="errCvv">Required</div>
        </div>
      </div>
  
      <input type="hidden" name="enc"            id="enc">
      <input type="hidden" name="netsMid"        value="${escHtml(netsMid)}">
      <input type="hidden" name="netsTxnRef"     value="${escHtml(netsTxnRef)}">
      <input type="hidden" name="txnRand"        value="${escHtml(txnRand)}">
      <input type="hidden" name="keyId"          value="${escHtml(keyId)}">
      <input type="hidden" name="hmac"           value="${escHtml(hmac)}">
      <input type="hidden" name="token" value="${escHtml(token)}">

<button type="submit" class="btn" id="submitBtn" aria-busy="false">
  <span id="btnLabel" aria-live="polite">Pay SGD ${escHtml(amtDisplay)}</span>
</button>
      <p class="lock">🔒 eNETS RSA-encrypted · Powered by eNETS</p>
      <div id="globalError"></div>
    </form>
  </div>
  
  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
  
    const RSA_N          = ${safeJson(n)};
    const RSA_E          = ${safeJson(e)};
    const MERCHANT_TXN_REF = ${safeJson(merchantTxnRef)};
    const amtDisplay     = ${safeJson(amtDisplay)};
    const BASE_PATH      = ${safeJson(basePath)};
  
    function linebrk(str, maxLen) {
      let out = '', i = 0;
      while (i + maxLen < str.length) { out += str.substring(i, i + maxLen) + '\\n'; i += maxLen; }
      return out + str.substring(i);
    }
  
function autoNext(curId, nextId, maxLen) {
  document.getElementById(curId).addEventListener('input', function (e) {
    if (e.inputType === 'deleteContentBackward' ||
        e.inputType === 'deleteContentForward') return;
    if (this.value.replace(/[^0-9]/g, '').length >= maxLen) {
      document.getElementById(nextId)?.focus();
    }
  });
}

    function autoBack(curId, prevId) {
      document.getElementById(curId).addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !this.value) {
          const prev = document.getElementById(prevId);
          prev?.focus();
          const len = prev?.value?.length ?? 0;
          prev?.setSelectionRange?.(len, len);
        }
      });
    }
  
    function setError(inputId, errId, msg) {
      document.getElementById(inputId).classList.add('error');
      const em = document.getElementById(errId);
      if (msg) em.textContent = msg;
      em.style.display = 'block';
    }
    function clearError(inputId, errId) {
      document.getElementById(inputId).classList.remove('error');
      document.getElementById(errId).style.display = 'none';
    }
  
    function validate() {
      ['cardName','cardEmail','cardNo','expMth','expYr','cvv'].forEach((id,i) =>
        clearError(id, ['errName','errEmail','errCard','errMth','errYr','errCvv'][i]));
      let ok = true;
      const name = document.getElementById('cardName').value.trim();
      const email = document.getElementById('cardEmail').value.trim();
      const card  = document.getElementById('cardNo').value.replace(/\\s/g,'');
      const mth   = document.getElementById('expMth').value.trim();
      const yr    = document.getElementById('expYr').value.trim();
      const cvv   = document.getElementById('cvv').value.trim();
      if (!name)  { setError('cardName','errName','Required'); ok = false; }
      if (!email || !/^[^@]+@[^@]+\\.[^@]+$/.test(email)) { setError('cardEmail','errEmail','Valid email required'); ok = false; }
      if (!card || card.length < 13 || card.length > 19 || !/^\\d+$/.test(card)) { setError('cardNo','errCard','Enter a valid card number'); ok = false; }
      const mInt = parseInt(mth, 10);
      if (!mth || isNaN(mInt) || mInt < 1 || mInt > 12) { setError('expMth','errMth','01–12'); ok = false; }
      if (!yr || yr.length !== 2 || !/^\\d{2}$/.test(yr)) { setError('expYr','errYr','2-digit year'); ok = false; }
      if (!cvv || cvv.length < 3 || !/^\\d+$/.test(cvv)) { setError('cvv','errCvv','3–4 digits'); ok = false; }
      return ok ? { name, email, card, mth: mth.padStart(2,'0'), yr, cvv } : null;
    }
  
    async function handleSubmit(e) {
      e.preventDefault();
      document.getElementById('globalError').style.display = 'none';
      const fields = validate();
      if (!fields) return false;
  
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true'); 
      document.getElementById('btnLabel').textContent = 'Encrypting…';
  
      try {
        var rsa = new RSAKey();
        rsa.setPublic(RSA_N, RSA_E);
        var res = rsa.encrypt('cardNo=' + fields.card + ',cvv=' + fields.cvv);
        if (!res) throw new Error('RSA encryption failed');
        var enc = 'RSA' + linebrk(res, 2048);
  
        // Read hidden fields from the form DOM (set server-side)
        const txnRand  = document.querySelector('input[name=txnRand]').value;
        const keyId    = document.querySelector('input[name=keyId]').value;
        const hmacVal  = document.querySelector('input[name=hmac]').value;
        const netsMid  = document.querySelector('input[name=netsMid]').value;
        const netsTxnRef = document.querySelector('input[name=netsTxnRef]').value;
        const token = document.querySelector('input[name=token]').value;
        
        const payload = new URLSearchParams({
        token,

          browserJavaEnabled:       'false',
          browserJavaScriptEnabled: 'true',
          browserLanguage:          navigator.language || 'en-US',
          browserColorDepth:        String(screen.colorDepth || 24),
          browserScreenHeight:      String(window.innerHeight),
          browserScreenWidth:       String(window.innerWidth),
          browserTz:                String(new Date().getTimezoneOffset()),
          browserUserAgent:         navigator.userAgent,
          enc,
          netsMid,
          netsTxnRef,
          merchantTxnRef: MERCHANT_TXN_REF,
          txnRand,
          keyId,
          hmac:           hmacVal,
          currencyCode:   'SGD',
          txnAmount:      String(Math.round(${safeJson(Number(amount))} * 100)),
          name:           fields.name,
          expiryMonth:    fields.mth,
          imgPayMode: 'on',
          expiryYear:     '20' + fields.yr,   // 4-digit: server uses as-is
          consumerEmail:  fields.email,
          meterId:        ${safeJson(meterId)},
          address:        ${safeJson(address)},
          balance:        ${safeJson(balance)},
          amount:         'S$ ' + amtDisplay,
        });
  
        document.getElementById('btnLabel').textContent = 'Processing…';
  
        const result = await fetch(BASE_PATH + '/webapp/enets_pay', {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    payload.toString(),
        });
  
        const out = await result.json().catch(() => ({}));
        if (!result.ok || !out.ok) throw new Error(out.error || 'Payment request failed');
        
        window.location.href = BASE_PATH + '/webapp/result?token=' + encodeURIComponent(token);
  
      } catch (err) {
        btn.disabled = false;
        btn.setAttribute('aria-busy', 'false'); 
        document.getElementById('btnLabel').textContent = 'Pay SGD ' + amtDisplay;
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
  
    autoNext('expMth', 'expYr', 2);
    autoNext('expYr',  'cvv',   2);
    autoBack('expYr',  'expMth');
    autoBack('cvv',    'expYr');
  </script>
  </body>
  </html>`;
}

function renderFinalResultPage(parsed, basePath = CP2NUS_BASE_PATH) {
  const ok = parsed.status === "success";
  const title = ok ? "Top-Up Successful" : "Top-Up Failed";
  const reason = parsed.reason || "Unable to determine transaction outcome.";

  const logoBg = ok ? "var(--accent-dim)" : "rgba(255,92,92,0.12)";
  const logoBorder = ok ? "var(--accent)" : "var(--error)";
  const valueColor = ok ? "var(--accent)" : "var(--text)";
  const noteBg = ok ? "rgba(0,229,160,0.08)" : "rgba(255,92,92,0.08)";
  const noteBorder = ok ? "rgba(0,229,160,0.22)" : "rgba(255,92,92,0.25)";
  const noteColor = ok ? "var(--accent)" : "var(--error)";
  const btnBg = ok ? "var(--accent)" : "#2a2a2a";
  const btnColor = ok ? "#000" : "#fff";
  const subtitle = ok
    ? "Your transaction has been processed."
    : "Your transaction was not completed.";
  const logoEmoji = ok ? "✅" : "⚠️";

  const rawAmount =
    parsed.amount !== undefined &&
    parsed.amount !== null &&
    parsed.amount !== ""
      ? String(parsed.amount).replace(/[^0-9.]/g, "")
      : "";

  const amountDisplay = rawAmount
    ? `SGD ${escHtml(Number(rawAmount).toFixed(2))}`
    : "-";

  const topUpUrl =
    `${basePath}/webapp?txtMtrId=${encodeURIComponent(parsed.meterId || "")}` +
    `&txtAmount=${encodeURIComponent(rawAmount)}`;

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
  ${htmlHead({
    title,
    extra: `
      .card {
        max-width: 400px;
        text-align: center;
      }
  
      .logo {
        width: 52px;
        height: 52px;
        background: ${logoBg};
        border: 1.5px solid ${logoBorder};
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
        font-size: 24px;
      }
  
      h1 {
        margin: 0 0 8px;
        font-size: 1.25rem;
      }
  
      .subtitle {
        color: var(--muted);
        font-size: 0.9rem;
        margin-bottom: 24px;
      }
  
      .detail-value {
        color: ${valueColor};
      }
  
      .status-note {
        margin-top: 22px;
        padding: 14px;
        border-radius: 12px;
        font-size: 0.9rem;
        background: ${noteBg};
        border: 1px solid ${noteBorder};
        color: ${noteColor};
      }
  
      .actions {
        margin-top: 20px;
        display: grid;
        gap: 10px;
      }
  
      .btn {
        width: 100%;
        border: none;
        border-radius: 10px;
        padding: 12px 16px;
        font-family: var(--sans);
        font-size: 0.95rem;
        font-weight: 700;
        cursor: pointer;
        background: ${btnBg};
        color: ${btnColor};
      }
  
      .btn.secondary {
        background: #242424;
        color: #fff;
      }
    `,
  })}
  </head>
  <body>
  <div class="card">
    <div class="logo">${logoEmoji}</div>
    <h1>${escHtml(title)}</h1>
    <div class="subtitle">${escHtml(subtitle)}</div>

    <div class="detail-row"><span class="detail-label">Reference</span><span class="detail-value">${escHtml(parsed.merchantTxnRef || "-")}</span></div>
    <div class="detail-row"><span class="detail-label">Meter ID</span><span class="detail-value">${escHtml(parsed.meterId || "-")}</span></div>
    ${
      parsed.address
        ? `<div class="detail-row">
            <span class="detail-label">Address</span>
            <span class="detail-value">${escHtml(parsed.address)}</span>
          </div>`
        : ""
    }

    ${
      parsed.balance !== undefined &&
      parsed.balance !== null &&
      parsed.balance !== ""
        ? `<div class="detail-row">
            <span class="detail-label">Balance</span>
            <span class="detail-value">SGD ${escHtml(Number(parsed.balance).toFixed(2))}</span>
          </div>`
        : ""
    }
    <div class="detail-row">
      <span class="detail-label">Amount</span>
      <span class="detail-value">${amountDisplay}</span>
    </div>

    <div class="status-note">${escHtml(reason)}</div>
    <div class="actions">
      <button class="btn" id="topUpAgainBtn" data-url="${escHtml(topUpUrl)}">
 Top Up Again
</button>
<button class="btn secondary" id="closeBtn">Close</button>
    </div>
  </div>

  <script>
    ${telegramInit()}

  function closeMiniApp() {
    if (tg) {
      const payload = JSON.stringify({
        status: ${safeJson(parsed.status)},
        merchantTxnRef: ${safeJson(parsed.merchantTxnRef || "")},
        meterId: ${safeJson(parsed.meterId || "")},
        amount: ${safeJson(parsed.amount || "")},
        address: ${safeJson(parsed.address || "")},
        balance: ${safeJson(parsed.balance || "")},
reason: ${safeJson(reason)},
      });
      tg.sendData(payload);
      tg.close();
    }
  }

  document.getElementById('topUpAgainBtn').addEventListener('click', function() {
    window.location.href = this.dataset.url;
  });
  document.getElementById('closeBtn').addEventListener('click', closeMiniApp);

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
