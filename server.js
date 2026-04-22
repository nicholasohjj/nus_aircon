require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const valid = require('card-validator');
require('./bot');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const BASE = 'https://nus-utown.evs.com.sg';

const DEFAULT_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Upgrade-Insecure-Requests': '1',
};

function htmlDecode(str) {
    return String(str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  
  function extractEvsCallbackFromHtml(html) {
    const body = String(html || '');
  
    // Look for a form posting back to EVS transSumServlet
    const formMatch = body.match(
      /<form[^>]*action=["']([^"']*transSumServlet\?status=[^"']+)["'][^>]*>/i
    );
  
    const action = formMatch ? htmlDecode(formMatch[1]) : null;
  
    const message = extractHiddenField(body, 'message');
  
    if (!action || !message) return null;
  
    let status = null;
    let id = null;
  
    try {
      const u = new URL(action, BASE);
      status = u.searchParams.get('status');
      id = u.searchParams.get('id');
    } catch {
      const m =
        action.match(/transSumServlet\?status=([^&]+)&(?:amp;)?id=([^"&]+)/i) ||
        action.match(/transSumServlet\?status=([^&]+).*?[?&](?:amp;)?id=([^"&]+)/i);
  
      status = m?.[1] || null;
      id = m?.[2] || null;
    }
  
    if (!status || !id) return null;
  
    return {
      action,
      status,
      id,
      message,
    };
  }
  
  async function postResultToEvs({ status, id, message, jsessionid }) {
    const formBody = new URLSearchParams({
      message: String(message),
    }).toString();
  
    const headers = {
      ...DEFAULT_HEADERS,
      Origin: 'https://www.enets.sg',
      Referer: 'https://www.enets.sg/',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  
    if (jsessionid) {
      headers.Cookie = `JSESSIONID=${String(jsessionid).trim()}`;
    }
  
    const evsResp = await axios.post(
      `${BASE}/EVSWebPOS/transSumServlet?status=${encodeURIComponent(
        String(status)
      )}&id=${encodeURIComponent(String(id))}`,
      formBody,
      {
        headers,
        validateStatus: () => true,
        maxRedirects: 0,
      }
    );
  
    return {
      upstreamStatus: evsResp.status,
      html: String(evsResp.data || ''),
      parsed: parseEvsTransactionSummary(evsResp.data),
    };
  }

function extractMerchantTxnRef(html) {
  const body = String(html || '');
  const m =
    body.match(
      /<input[^>]*\bname=['"]merchant_txn_ref['"][^>]*\bvalue=['"]([^'"]+)['"][^>]*>/i
    ) ||
    body.match(/\bmerchant_txn_ref\b[^]*?\bvalue=['"]([^'"]+)['"]/i);
  return m?.[1] || null;
}

function extractEnetsMessage(html) {
  const body = String(html || '');
  const m = body.match(
    /<input[^>]*\bname=['"]message['"][^>]*\bvalue=['"]([^'"]+)['"][^>]*>/i
  );
  return m?.[1] || null;
}

function ensureBaseHref(html, baseHref) {
  const body = String(html || '');
  if (!body) return body;
  if (/<base\b/i.test(body)) return body;
  const headOpen = body.match(/<head\b[^>]*>/i)?.[0];
  if (!headOpen) return body;
  return body.replace(
    /<head\b[^>]*>/i,
    `${headOpen}\n<base href="${String(baseHref)}">`
  );
}

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

function normalizeFinalOutcome(parsed = {}) {
    const reason = parsed.reason || 'Unable to determine transaction outcome.';
  
    // Only two outcomes:
    // - explicit failure text => failure
    // - anything else => success
    const isFailure =
      parsed.status === 'failure' ||
      /rejected by financial institution/i.test(reason) ||
      /failed to purchase/i.test(reason);
  
    return {
      ...parsed,
      status: isFailure ? 'failure' : 'success',
      reason: isFailure ? reason : 'Payment completed.',
    };
  }
function parseEvsTransactionSummary(html) {
    const body = String(html || '');
  
    const title =
      body.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || null;
  
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
      body.match(/Total Amount \(Inclusive of GST\)[\s\S]*?<b>(S\$ ?[\d.]+)<\/b>/i)?.[1]?.trim() ||
      body.match(/<b>S\$ ?([\d.]+)<\/b>/i)?.[1] ||
      null;
  
    const isFailure =
      /Transaction is rejected by financial institution\./i.test(body);
  
    return {
      title,
      merchantTxnRef,
      meterId,
      address,
      amount,
      status: isFailure ? 'failure': 'success',
      reason: isFailure
      ? 'Transaction is rejected by financial institution.'
      : 'Payment completed.',
    };
  }

  function renderFinalResultPage(parsed) {
    const ok = parsed.status === 'success';
    const title = ok ? 'Top-Up Successful' : 'Top-Up Failed';
    const reason = parsed.reason || 'Unable to determine transaction outcome.';
  
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');
  
    :root {
      --bg: #0d0d0d;
      --surface: #161616;
      --border: #2a2a2a;
      --accent: #00e5a0;
      --accent-dim: rgba(0,229,160,0.12);
      --text: #f0f0f0;
      --muted: #888;
      --error: #ff5c5c;
      --mono: 'DM Mono', monospace;
      --sans: 'DM Sans', sans-serif;
    }
  
    * { box-sizing: border-box; }
  
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
  
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 28px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
  
    .logo {
      width: 52px;
      height: 52px;
      background: ${ok ? 'var(--accent-dim)' : 'rgba(255,92,92,0.12)'};
      border: 1.5px solid ${ok ? 'var(--accent)' : 'var(--error)'};
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
  
    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }
  
    .detail-row:last-of-type {
      border-bottom: none;
    }
  
    .detail-label {
      color: var(--muted);
    }
  
    .detail-value {
      color: ${ok ? 'var(--accent)' : 'var(--text)'};
      font-family: var(--mono);
      font-weight: 500;
      text-align: right;
      max-width: 58%;
      word-break: break-word;
    }
  
    .status-note {
      margin-top: 22px;
      padding: 14px;
      border-radius: 12px;
      font-size: 0.9rem;
      background: ${ok ? 'rgba(0,229,160,0.08)' : 'rgba(255,92,92,0.08)'};
      border: 1px solid ${ok ? 'rgba(0,229,160,0.22)' : 'rgba(255,92,92,0.25)'};
      color: ${ok ? 'var(--accent)' : 'var(--error)'};
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
      background: ${ok ? 'var(--accent)' : '#2a2a2a'};
      color: ${ok ? '#000' : '#fff'};
    }
  
    .btn.secondary {
      background: #242424;
      color: #fff;
    }
  </style>
  </head>
  <body>
    <div class="card">
      <div class="logo">${ok ? '✅' : '⚠️'}</div>
      <h1>${escHtml(title)}</h1>
      <div class="subtitle">${ok ? 'Your transaction has been processed.' : 'Your transaction was not completed.'}</div>
  
      <div class="detail-row">
        <span class="detail-label">Reference</span>
        <span class="detail-value">${escHtml(parsed.merchantTxnRef || '-')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Meter ID</span>
        <span class="detail-value">${escHtml(parsed.meterId || '-')}</span>
      </div>
      ${
        parsed.address
          ? `
      <div class="detail-row">
        <span class="detail-label">Address</span>
        <span class="detail-value">${escHtml(parsed.address)}</span>
      </div>`
          : ''
      }
      ${
        parsed.balance !== undefined && parsed.balance !== null && parsed.balance !== ''
          ? `
      <div class="detail-row">
        <span class="detail-label">Balance</span>
        <span class="detail-value">SGD ${escHtml(Number(parsed.balance).toFixed(2))}</span>
      </div>`
          : ''
      }
      <div class="detail-row">
        <span class="detail-label">Amount</span>
        <span class="detail-value">${escHtml(parsed.amount || '-')}</span>
      </div>
  
      <div class="status-note">${escHtml(reason)}</div>
  
      <div class="actions">
        <button class="btn" onclick="window.location.href='/webapp?txtMtrId=${encodeURIComponent(parsed.meterId || '')}&txtAmount=${encodeURIComponent((parsed.amount || '').replace(/[^0-9.]/g, ''))}'">
          Top Up Again
        </button>
        <button class="btn secondary" onclick="closeMiniApp()">Close</button>
      </div>
    </div>
  
  <script>
    function closeMiniApp() {
      const tg = window.Telegram?.WebApp;
      if (tg) tg.close();
    }
  </script>
  </body>
  </html>`;
  }

async function getFollowRedirects(client, url, { params, headers, maxHops = 4 } = {}) {
  let currentUrl = String(url);
  let resp = null;
  let hops = 0;

  while (hops <= maxHops) {
    resp = await client.get(currentUrl, { params, headers });
    const status = resp?.status;
    const loc = resp?.headers?.location;

    if (!isRedirectStatus(status) || !loc) return resp;

    const nextUrl = resolveUpstreamLocation(currentUrl, loc);
    if (!nextUrl) return resp;

    currentUrl = nextUrl;
    // after the first hop, avoid re-sending query params (they might already be embedded)
    params = undefined;
    hops++;
  }

  return resp;
}

function classifyLoginResponse(html) {
  const body = String(html || '');
  const isValid =
    body.includes('<title>EVS POS Package Selection Page</title>') ||
    body.includes('action="/EVSWebPOS/selectOfferServlet"') ||
    body.includes('Please confirm you are purchasing for the above premise');
  const isInvalid =
    body.includes('<title>EVS POS Main Page</title>') ||
    body.includes('Meter not found.') ||
    body.includes('action="/EVSWebPOS/loginServlet"');
  if (isValid) return 'valid';
  if (isInvalid) return 'invalid';
  return 'unknown';
}

function classifySelectOfferResponse(html) {
  const body = String(html || '');
  const isSuccess =
    body.includes('<title>EVS POS Payment Selection Page</title>') ||
    body.includes('Please select a payment mode') ||
    body.includes('img_creditcard') ||
    body.includes('hidPurAmt');
  const isMainPage =
    body.includes('<title>EVS POS Main Page</title>') ||
    body.includes('Meter not found.') ||
    body.includes('action="/EVSWebPOS/loginServlet"');
  const isPackagePage =
    body.includes('<title>EVS POS Package Selection Page</title>') ||
    body.includes('Please confirm you are purchasing for the above premise') ||
    body.includes('action="/EVSWebPOS/selectOfferServlet"');
  if (isSuccess) return 'success';
  if (isMainPage) return 'session_or_login_failed';
  if (isPackagePage) return 'stayed_on_package_page';
  return 'unknown';
}

function cardPaymentPage({ n, e, netsMid, netsTxnRef, merchantTxnRef, amount, meterId, actionUrl, address='', balance='' }) {
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
      border-radius: 16px; padding: 28px 24px; width: 100%; max-width: 400px; }
    .logo { width: 44px; height: 44px; background: var(--accent-dim);
      border: 1.5px solid var(--accent); border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; margin-bottom: 18px; }
    h1 { font-size: 1.15rem; font-weight: 700; margin-bottom: 4px; }
    .sub { color: var(--muted); font-size: 0.82rem; margin-bottom: 20px; }
    .summary { background: rgba(0,229,160,0.07); border: 1px solid rgba(0,229,160,0.18);
      border-radius: 10px; padding: 10px 14px; margin-bottom: 20px;
      font-size: 0.85rem; display: flex; justify-content: space-between; }
    .summary .val { font-family: var(--mono); color: var(--accent); font-weight: 500; }
    .field { margin-bottom: 14px; }
    label { display: block; font-size: 11px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
    input { width: 100%; height: 40px; background: #111; border: 1px solid var(--border);
      border-radius: 9px; color: var(--text); font-size: 15px;
      font-family: var(--mono); padding: 0 12px; outline: none;
      transition: border-color 0.15s; }
    input:focus { border-color: var(--accent); }
    input.error { border-color: var(--error); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .btn { width: 100%; height: 44px; background: var(--accent); color: #000;
      border: none; border-radius: 10px; font-family: var(--sans);
      font-size: 1rem; font-weight: 700; cursor: pointer; margin-top: 6px;
      display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .lock { font-size: 11px; color: var(--muted); text-align: center; margin-top: 10px; }
    .err-msg { font-size: 11px; color: var(--error); margin-top: 4px; display: none; }
    #globalError { background: rgba(255,92,92,0.08); border: 1px solid rgba(255,92,92,0.3);
      border-radius: 10px; padding: 12px 14px; font-size: 0.83rem; color: var(--error);
      margin-top: 14px; display: none; font-family: var(--mono); }
  </style>
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
  
    const RSA_N = ${JSON.stringify(n)};
    const RSA_E = ${JSON.stringify(e)};
    const ACTION_URL = ${JSON.stringify(actionUrl || 'https://www.enets.sg/enets2/PaymentListener.do')};
    const MERCHANT_TXN_REF = ${JSON.stringify(merchantTxnRef)};

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
  e: ${JSON.stringify(e)},
  n: ${JSON.stringify(n)},
  netsMid: ${JSON.stringify(netsMid)},
  netsTxnRef: ${JSON.stringify(netsTxnRef)},
  merchantTxnRef: MERCHANT_TXN_REF,
  currencyCode: 'SGD',
  txnAmount: String(Math.round(${JSON.stringify(Number(amount))} * 100)),
  name: fields.name,
  cardNo: '****************',
  cvv: '***',
  expiryMonth: fields.mth,
  expiryYear: '20' + fields.yr,
  consumerEmail: fields.email,
  agree: 'Y',
  meterId: ${JSON.stringify(meterId)},
  address: ${JSON.stringify(address)},
  balance: ${JSON.stringify(balance)},
  amount: ${JSON.stringify('S$ ' + amtDisplay)},
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

// Redirect to your result page
const q = new URLSearchParams({
  status: out.status || 'unknown',
  ref: out.merchantTxnRef || MERCHANT_TXN_REF || '',
  meterId: out.meterId || ${JSON.stringify(meterId)},
  amount: out.amount || ${JSON.stringify('SGD ' + amtDisplay)},
  reason: out.reason || '',
  address: out.address || ${JSON.stringify(address)},
  balance: ${JSON.stringify(balance)},
}).toString();

window.location.href = '/webapp/result?' + q;
  
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
autoNext('cardNo', 'expMth', 16);
autoNext('expMth', 'expYr', 2);
autoNext('expYr', 'cvv', 2);
  </script>
  </body>
  </html>`;
}

function extractHiddenField(html, name) {
    const m = String(html || '').match(
      new RegExp(
        `<input[^>]*\\bname=['"]${name}['"][^>]*\\bvalue=['"]([^'"]*)['"\\s]`,
        'i'
      ) ||
      new RegExp(
        `<input[^>]*\\bvalue=['"]([^'"]*)['"\\s][^>]*\\bname=['"]${name}['"]`,
        'i'
      )
    );
    return m?.[1] || null;
  }

  function parseEnetsResult(html) {
    const body = String(html || '');
  
    // Case 1: wrapper page containing window.open('/GW2/popup/u_receipt.jsp?...')
    const match = body.match(/window\.open\(['"]([^'"]+)['"]/i);
    if (match) {
      let url = match[1];
      url = url.replace(/\?status=([^&?]+)\?/, '?status=$1&');
  
      const qIndex = url.indexOf('?');
      if (qIndex !== -1) {
        const rawQuery = url.slice(qIndex + 1);
        const params = {};
        for (const pair of rawQuery.split('&')) {
          const eq = pair.indexOf('=');
          if (eq === -1) continue;
          const key = pair.slice(0, eq);
          const value = pair.slice(eq + 1);
          params[key] = value;
        }
  
        return {
          status: params.status || 'unknown',
          bankAuthId: params.bankAuthId || null,
          merchantTxnRef: params.merchantTxnRef || null,
          netsTxnRef: params.netsTxnRef || null,
          txnDateTime: params.txnDateTime || null,
          error: params.error || null,
          deductedAmount: params.deductedAmount || null,
          source: 'window_open',
        };
      }
    }
  
    // Case 2: final receipt page HTML
    const isReceiptPage =
      /<title>\s*Receipt\s*<\/title>/i.test(body) ||
      /u_receipt_/i.test(body);
  
    if (isReceiptPage) {
      const liMatches = [...body.matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map(m => m[1].trim());
      const message = liMatches.join(' | ') || null;
  
      let status = 'unknown';
      if (/please contact merchant/i.test(body) || /fail|declin|reject/i.test(body)) {
        status = 'failure';
      } else if (/success|approved|completed/i.test(body)) {
        status = 'success';
      }
  
      return {
        status,
        bankAuthId: null,
        merchantTxnRef: null,
        netsTxnRef: null,
        txnDateTime: null,
        error: message,
        deductedAmount: null,
        source: 'receipt_html',
      };
    }
  
    return null;
  }

  async function getMeterSummary(meterDisplayName) {
    const meterId = String(meterDisplayName || '').trim();
    if (!meterId) {
      return { address: null, credit_bal: null };
    }
  
    const commonHeaders = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json; charset=UTF-8',
      Origin: 'https://cp2.evs.com.sg',
      Referer: 'https://cp2.evs.com.sg/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      Authorization: 'Bearer',
    };
  
    const [meterInfoResp, balResp] = await Promise.allSettled([
      axios.post(
        'https://ore.evs.com.sg/cp/get_meter_info',
        {
          request: {
            meter_displayname: meterId,
          },
        },
        {
          headers: commonHeaders,
          validateStatus: () => true,
        }
      ),
      axios.post(
        'https://ore.evs.com.sg/evs1/get_credit_bal',
        {
          svcClaimDto: {
            username: meterId,
            user_id: null,
            svcName: 'oresvc',
            endpoint: '/evs1/get_credit_bal',
            scope: 'self',
            target: 'meter.credit_balance',
            operation: 'read',
          },
          request: {
            meter_displayname: meterId,
          },
        },
        {
          headers: commonHeaders,
          validateStatus: () => true,
        }
      ),
    ]);
  
    let address = null;
    let credit_bal = null;
  
    if (meterInfoResp.status === 'fulfilled' && meterInfoResp.value.status === 200) {
      address = meterInfoResp.value.data?.meter_info?.address || null;
    }
  
    if (balResp.status === 'fulfilled' && balResp.value.status === 200) {
      credit_bal = balResp.value.data?.credit_bal ?? null;
    }
  
    return { address, credit_bal };
  }

async function createClient() {
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      validateStatus: () => true,
      maxRedirects: 0,
      headers: DEFAULT_HEADERS,
    })
  );
  return { client, jar };
}

async function runPurchaseFlow({ txtMtrId, txtAmount }) {
  const result = { ok: false, stage: 'init' };

  if (!txtMtrId) return { ...result, error: 'Missing txtMtrId' };
  if (txtAmount === undefined || txtAmount === null || txtAmount === '')
    return { ...result, error: 'Missing txtAmount' };

  const cleanedAmount = String(txtAmount).replace(/[^0-9.]/g, '');
  const amountDollars = Number(cleanedAmount);
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
    return { ...result, error: 'Invalid txtAmount' };
  }
  
  const amountCents = Math.round(amountDollars * 100);
  const { client, jar } = await createClient();

    result.stage = 'evs_home';
  const step1 = await client.get(`${BASE}/EVSWebPOS/`);

  result.stage = 'login';
  const loginForm = new URLSearchParams({
    txtMtrId: String(txtMtrId),
    btnLogin: 'Submit',
    radRetail: '1',
  }).toString();

  const step2 = await client.post(`${BASE}/EVSWebPOS/loginServlet`, loginForm, {
    headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const loginResult = classifyLoginResponse(step2.data);
  if (loginResult !== 'valid') {
    const cookies = await jar.getCookies(BASE + '/EVSWebPOS/');
    return {
      ok: false, stage: 'login',
      step1Status: step1.status, step2Status: step2.status,
      loginResult,
      cookieHeader: cookies.map(c => `${c.key}=${c.value}`).join('; '),
    };
  }

  result.stage = 'select_offer';
  const selectForm = new URLSearchParams({
    isDedicated: '0',
    hidMinPur: '1',
    hidMaxPur: '500',
    hidSelected: '',
    txtAmount: String(amountDollars),
    btnProceed: 'Proceed',
    btnCancel: 'Cancel',
  }).toString();

  const step3 = await client.post(`${BASE}/EVSWebPOS/selectOfferServlet`, selectForm, {
    headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const selectResult = classifySelectOfferResponse(step3.data);
  const cookies = await jar.getCookies(BASE + '/EVSWebPOS/');

  if (selectResult !== 'success') {
    return {
      ok: false, stage: 'select_offer',
      step1Status: step1.status, step2Status: step2.status, step3Status: step3.status,
      loginResult, selectResult,
      cookieHeader: cookies.map(c => `${c.key}=${c.value}`).join('; '),
      preview: {
        loginTitle: String(step2.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        selectTitle: String(step3.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
      },
    };
  }

  result.stage = 'payment_servlet';

  const step4 = await getFollowRedirects(client, `${BASE}/EVSWebPOS/paymentServlet`, {
    params: { mode: '0', isDedicated: '1' },
    headers: { ...DEFAULT_HEADERS, Referer: `${BASE}/EVSWebPOS/selectOfferServlet` },
  });

  const merchant_txn_ref = extractMerchantTxnRef(step4.data);
  if (!merchant_txn_ref) {
    return {
      ok: false, stage: 'payment_servlet',
      step1Status: step1.status, step2Status: step2.status,
      step3Status: step3.status, step4Status: step4.status,
      loginResult, selectResult,
      cookieHeader: cookies.map(c => `${c.key}=${c.value}`).join('; '),
      error: 'merchant_txn_ref not found in paymentServlet HTML',
      upstream: {
        paymentTitle: String(step4.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        paymentContentType: step4.headers?.['content-type'] || null,
        paymentLocation: step4.headers?.location || null,
        paymentPreview: String(step4.data || '').slice(0, 800),
      },
    };
  }

  result.stage = 'creditpayment';

  const formBody = new URLSearchParams({
    amt: amountDollars.toFixed(2),
    payment_mode: 'CC',
    txn_amount: String(amountCents),
    currency_code: 'SGD',
    merchant_txn_ref: String(merchant_txn_ref),
    submission_mode: 'B',
    payment_type: 'SALE',
  }).toString();

  const step5 = await axios.post(
    'http://120.50.44.233/payment/creditpayment.jsp',
    formBody,
    {
      headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    }
  );

  const enetsMessage = extractEnetsMessage(step5.data);
  if (!enetsMessage) {
    return {
      ok: false, stage: 'enets_paymentlistener',
      step1Status: step1.status, step2Status: step2.status,
      step3Status: step3.status, step4Status: step4.status, step5Status: step5.status,
      loginResult, selectResult, merchant_txn_ref,
      cookieHeader: cookies.map(c => `${c.key}=${c.value}`).join('; '),
      error: 'message not found in creditpayment.jsp HTML',
    };
  }
  result.stage = 'enets_paymentlistener';

  const step6Body = new URLSearchParams({ message: String(enetsMessage) }).toString();
  const step6 = await axios.post(
    'https://www.enets.sg/enets2/PaymentListener.do',
    step6Body,
    {
      headers: {
        ...DEFAULT_HEADERS,
        Origin: 'http://120.50.44.233',
        Referer: 'http://120.50.44.233/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      validateStatus: () => true,
    }
  );

  const enetsHtml = String(step6.data || '');
  const netsMid    = extractHiddenField(enetsHtml, 'netsMid');
  const e          = extractHiddenField(enetsHtml, 'e');
  const n          = extractHiddenField(enetsHtml, 'n');
  const netsTxnRef = extractHiddenField(enetsHtml, 'netsTxnRef');

  return {
    ok: true, stage: 'enets_paymentlistener',
    step1Status: step1.status, step2Status: step2.status,
    step3Status: step3.status, step4Status: step4.status,
    step5Status: step5.status, step6Status: step6.status,
    enetsBody: step6.data,
    enets: { netsMid, e, n, netsTxnRef },
  };
}

// ── Existing routes ───────────────────────────────────────────────────────────

app.post('/purchase_flow', async (req, res) => {
  try {
    console.log(req.body)
    const out = await runPurchaseFlow(req.body || {});
    console.log("OUT: ", out)
    const status = out?.error && (out.error.includes('Missing') || out.error.includes('Invalid')) ? 400 : 200;
    return res.status(status).json(out);
  } catch (error) {
    return res.status(500).json({ error: error.message, responseStatus: error.response?.status || null });
  }
});

app.get('/purchase_flow/enets', async (req, res) => {
  try {
    const out = await runPurchaseFlow(req.query || {});
    if (!out?.ok || !out?.enetsBody) return res.status(502).json(out);
    const html = ensureBaseHref(out.enetsBody, 'https://www.enets.sg/');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send(String(error?.message || error));
  }
});

app.get('/webapp/result', (req, res) => {
    const {
      status = 'unknown',
      ref = '',
      meterId = '',
      amount = '',
      reason = '',
      address = '',
      balance = '',
    } = req.query;
  
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    return res.send(
      renderFinalResultPage({
        status,
        merchantTxnRef: ref,
        meterId,
        amount,
        reason,
        address,
        balance,
      })
    );
  });

  app.get('/webapp/bootstrap', async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res.status(400).json({
      ok: false,
      stage: 'init',
      error: 'Missing meter ID or amount.',
    });
  }

  try {
    const [out, meterSummary] = await Promise.all([
        runPurchaseFlow({ txtMtrId, txtAmount }),
        getMeterSummary(txtMtrId),
      ]);

    if (!out?.ok) {
      return res.status(502).json(out);
    }

    const enetsHtml = String(out.enetsBody || '');
    const $ = cheerio.load(enetsHtml);

    const netsMid        = extractHiddenField(enetsHtml, 'netsMid');
    const e              = extractHiddenField(enetsHtml, 'e');
    const n              = extractHiddenField(enetsHtml, 'n');
    const netsTxnRef     = extractHiddenField(enetsHtml, 'netsTxnRef');
    const merchantTxnRef = extractHiddenField(enetsHtml, 'merchant_txn_ref') || extractMerchantTxnRef(enetsHtml);
    const rawActionUrl   = $('form').first().attr('action') || '/enets2/PaymentListener.do';
    const actionUrl      = new URL(rawActionUrl, 'https://www.enets.sg').toString();

    if (!n || !e || !netsMid || !netsTxnRef) {
        return res.status(502).json({ ok: false, error: 'Missing eNETS key fields.' });
      }
  
      const params = new URLSearchParams({
        txtMtrId,
        txtAmount,
        address:      meterSummary.address    || '',
        balance:      meterSummary.credit_bal ?? '',
        n, e, netsMid, netsTxnRef,
        merchantTxnRef: merchantTxnRef || '',
        actionUrl,
      });
 
      return res.status(200).json({
        ok: true,
        stage: out.stage,
        redirectUrl: '/webapp/pay?' + params.toString(),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, stage: 'init', error: err.message || 'Unknown error' });
    }
  });

app.get('/evs/merchant_txn_ref', async (req, res) => {
  try {
    const { mode = '0', isDedicated = '1', jsessionid } = req.query;
    const cookieFromHeader = req.header('cookie') || '';
    const cookieHeader = jsessionid && String(jsessionid).trim()
      ? `JSESSIONID=${String(jsessionid).trim()}` : cookieFromHeader;
    const response = await axios.get(`${BASE}/EVSWebPOS/paymentServlet`, {
      params: { mode: String(mode), isDedicated: String(isDedicated) },
      headers: { ...DEFAULT_HEADERS, ...(cookieHeader ? { Cookie: cookieHeader } : {}), Referer: `${BASE}/EVSWebPOS/selectOfferServlet` },
      validateStatus: () => true,
      maxRedirects: 5,
    });
    if (response.status !== 200) return res.status(502).json({ error: 'Upstream returned non-200', upstreamStatus: response.status });
    const merchant_txn_ref = extractMerchantTxnRef(response.data);
    if (!merchant_txn_ref) {
      return res.status(502).json({
        error: 'merchant_txn_ref not found in upstream HTML',
        upstreamStatus: response.status,
        upstreamTitle: String(response.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        upstreamContentType: response.headers?.['content-type'] || null,
        upstreamPreview: String(response.data || '').slice(0, 800),
      });
    }
    return res.status(200).json({ merchant_txn_ref });
  } catch (error) {
    return res.status(500).json({ error: error.message, responseStatus: error.response?.status || null });
  }
});

app.post('/webapp/enets_pay', express.urlencoded({ extended: false, limit: '10mb' }), async (req, res) => {
    try {
      const body = new URLSearchParams(req.body).toString();
  
      const enetsResp = await axios.post(
        'https://www.enets.sg/GW2/uCredit/pay',
        body,
        {
          headers: {
            ...DEFAULT_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://www.enets.sg',
            Referer: 'https://www.enets.sg/enets2/PaymentListener.do',
          },
          validateStatus: () => true,
          maxRedirects: 5,
        }
      );
  
      const html = String(enetsResp.data || '');
  
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

        
return res.status(200).json({
    ok: true,
    source: 'evs_transsum',
    status: normalized.status || 'unknown',
    merchantTxnRef: normalized.merchantTxnRef || evsCb.id || req.body.merchantTxnRef || '',
    meterId: req.body.meterId || normalized.meterId || '',
    address: req.body.address || '',
    balance: req.body.balance || '',
    amount: req.body.amount || normalized.amount || '',
    reason: normalized.reason || '',
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
          error: 'Could not parse eNETS response or EVS callback form',
          preview: html.slice(0, 1200),
        });
      }
  
      const ok = receipt.status === 'success';
  
      return res.status(200).json({
        ok: true,
        source: 'enets_receipt_fallback',
        status: receipt.status,
        merchantTxnRef: receipt.merchantTxnRef || req.body.merchantTxnRef || req.body.merchant_txn_ref || '',
        amount: receipt.deductedAmount || '',
        reason: ok ? 'Payment completed.' : (receipt.error || 'Transaction failed.'),
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  });

  app.get('/webapp/pay', (req, res) => {
    const { txtMtrId, txtAmount, address = '', balance = '',
            n, e, netsMid, netsTxnRef, merchantTxnRef, actionUrl } = req.query;
  
    if (!txtMtrId || !txtAmount || !n || !e || !netsMid || !netsTxnRef) {
      return res.status(400).send(errorPage('Missing required payment parameters.'));
    }
  
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    return res.send(cardPaymentPage({
      n, e, netsMid, netsTxnRef,
      merchantTxnRef: merchantTxnRef || '',
      actionUrl: actionUrl || 'https://www.enets.sg/enets2/PaymentListener.do',
      amount: txtAmount,
      meterId: txtMtrId,
      address,
      balance,
    }));
  });

app.post('/evs/creditpayment', async (req, res) => {
  try {
    const { mode = '0', isDedicated = '1', jsessionid, amt = '0.01', payment_mode = 'CC',
      txn_amount = '1', currency_code = 'SGD', submission_mode = 'B', payment_type = 'SALE' } = req.body || {};
    const cookieFromHeader = req.header('cookie') || '';
    const cookieHeader = jsessionid && String(jsessionid).trim()
      ? `JSESSIONID=${String(jsessionid).trim()}` : cookieFromHeader;
    const evsResp = await axios.get(`${BASE}/EVSWebPOS/paymentServlet`, {
      params: { mode: String(mode), isDedicated: String(isDedicated) },
      headers: { ...DEFAULT_HEADERS, ...(cookieHeader ? { Cookie: cookieHeader } : {}), Referer: `${BASE}/EVSWebPOS/selectOfferServlet` },
      validateStatus: () => true,
      maxRedirects: 5,
    });
    if (evsResp.status !== 200) return res.status(502).json({ error: 'EVS paymentServlet returned non-200', upstreamStatus: evsResp.status });
    const merchant_txn_ref = extractMerchantTxnRef(evsResp.data);
    if (!merchant_txn_ref) {
      return res.status(502).json({
        error: 'merchant_txn_ref not found in EVS HTML',
        upstreamStatus: evsResp.status,
        upstreamTitle: String(evsResp.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        upstreamContentType: evsResp.headers?.['content-type'] || null,
        upstreamPreview: String(evsResp.data || '').slice(0, 800),
      });
    }
    const formBody = new URLSearchParams({ amt: String(amt), payment_mode: String(payment_mode),
      txn_amount: String(txn_amount), currency_code: String(currency_code),
      merchant_txn_ref: String(merchant_txn_ref), submission_mode: String(submission_mode),
      payment_type: String(payment_type) }).toString();
    const payResp = await axios.post('http://120.50.44.233/payment/creditpayment.jsp', formBody, {
      headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    return res.status(200).json({ merchant_txn_ref, paymentUpstreamStatus: payResp.status,
      paymentContentType: payResp.headers?.['content-type'] || null,
      paymentBody: typeof payResp.data === 'string' ? payResp.data : payResp.data });
  } catch (error) {
    return res.status(500).json({ error: error.message, responseStatus: error.response?.status || null });
  }
});

// ── NEW: Telegram WebApp route ────────────────────────────────────────────────
// Serves a loading page, runs the full purchase flow server-side,
// then renders the eNETS payment page directly inside the WebApp.
app.get('/webapp', async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res.status(400).send(errorPage('Missing meter ID or amount.'));
  }

  try {
    const meterSummary = await getMeterSummary(txtMtrId);
    return res.status(200).send(loadingPage(txtMtrId, txtAmount, meterSummary));
  } catch (err) {
    return res.status(200).send(
      loadingPage(txtMtrId, txtAmount, { address: null, credit_bal: null })
    );
  }
});

app.post('/webapp/transsum', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const { status = '0', id } = req.query;
      const { message } = req.body || {};
  
      if (!message || !id) {
        return res.status(400).send(errorPage('Missing transaction return data.'));
      }
  
      const formBody = new URLSearchParams({
        message: String(message),
      }).toString();
  
      const evsResp = await axios.post(
        `${BASE}/EVSWebPOS/transSumServlet?status=${encodeURIComponent(String(status))}&id=${encodeURIComponent(String(id))}`,
        formBody,
        {
          headers: {
            ...DEFAULT_HEADERS,
            Origin: 'https://www.enets.sg',
            Referer: 'https://www.enets.sg/',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          validateStatus: () => true,
        }
      );
  
      const parsed = parseEvsTransactionSummary(evsResp.data);
  
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      const q = new URLSearchParams({
        status: parsed.status || 'unknown',
        ref: parsed.merchantTxnRef || '',
        meterId: parsed.meterId || '',
        amount: parsed.amount || '',
        reason: parsed.reason || '',
        address: parsed.address || '',
        balance: parsed.balance ?? '',
      }).toString();
      
      return res.redirect(`/webapp/result?${q}`);
    } catch (err) {
      return res.status(500).send(
        errorPage(err.message || 'Failed to process transaction result.')
      );
    }
  });
// ── HTML helpers ──────────────────────────────────────────────────────────────

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
<title>EVS Payment</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d0d0d;
    --surface: #161616;
    --border: #2a2a2a;
    --accent: #00e5a0;
    --accent-dim: rgba(0,229,160,0.12);
    --text: #f0f0f0;
    --muted: #888;
    --error: #ff5c5c;
    --mono: 'DM Mono', monospace;
    --sans: 'DM Sans', sans-serif;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px 28px;
    width: 100%;
    max-width: 380px;
    text-align: center;
  }

  .logo {
    width: 52px;
    height: 52px;
    background: var(--accent-dim);
    border: 1.5px solid var(--accent);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    font-size: 24px;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
  }

  .subtitle {
    color: var(--muted);
    font-size: 0.85rem;
    margin-bottom: 28px;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.875rem;
  }
  .detail-row:last-of-type { border-bottom: none; }
  .detail-label { color: var(--muted); }
  .spinner-wrap {
    margin: 32px 0 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .detail-value {
  font-family: var(--mono);
  font-weight: 500;
  color: var(--accent);
  max-width: 58%;
  text-align: right;
  word-break: break-word;
}

  .spinner {
    width: 36px;
    height: 36px;
    border: 2.5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .status-text {
    color: var(--muted);
    font-size: 0.82rem;
    font-family: var(--mono);
    min-height: 1.2em;
    transition: opacity 0.3s;
  }

  .error-card {
    background: rgba(255,92,92,0.08);
    border: 1px solid rgba(255,92,92,0.3);
    border-radius: 12px;
    padding: 16px;
    margin-top: 20px;
    font-size: 0.83rem;
    color: var(--error);
    display: none;
    text-align: left;
    font-family: var(--mono);
    line-height: 1.5;
  }

  .retry-btn {
    margin-top: 16px;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 10px;
    padding: 12px 24px;
    font-family: var(--sans);
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    display: none;
    width: 100%;
  }
</style>
</head>
<body>
<div class="card">
  <div class="logo">⚡</div>
  <h1>Electricity Top-Up</h1>
  <p class="subtitle">Connecting to EVS payment gateway…</p>

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
      : ''
  }

  ${
    balanceDisplay !== null
      ? `
  <div class="detail-row">
    <span class="detail-label">Current Balance</span>
    <span class="detail-value">SGD ${escHtml(balanceDisplay)}</span>
  </div>`
      : ''
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
  <button class="retry-btn" id="retryBtn" onclick="runFlow()">Try Again</button>
</div>

<script>
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  const METER_ID = ${JSON.stringify(txtMtrId)};
  const TXN_AMOUNT = ${JSON.stringify(txtAmount)};

  const statusEl = document.getElementById('statusText');
  const errorEl = document.getElementById('errorCard');
  const retryBtn = document.getElementById('retryBtn');
  const spinnerWrap = document.getElementById('spinnerWrap');

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
      errorEl.textContent = '⚠️ ' + (err.message || 'Unknown error');
      errorEl.style.display = 'block';
      retryBtn.style.display = 'block';
    }
  }

  runFlow();
</script>
</body>
</html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d0d0d;color:#ff5c5c;padding:24px;text-align:center;}</style>
</head><body><div><h2>Error</h2><p>${escHtml(msg)}</p></div></body></html>`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

