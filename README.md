# EVS Electricity Top-Up Bot

A Telegram bot and Express web server that lets NUS hostel residents top up their EVS electricity meters via credit card, without needing to visit a physical terminal.

## Supported Hostels

| Hostel Group                                          | EVS System          |
| ----------------------------------------------------- | ------------------- |
| PGPR, Houses @ PGP, Residential Colleges, NUS College | `cp2.evs.com.sg`    |
| UTown Residence, RVRC                                 | `cp2nus.evs.com.sg` |

## Features

- Check meter balance and 7-day usage history from within Telegram
- Top up electricity via credit card (SGD $6–$50)
- RSA-encrypted card entry in a Telegram WebApp (Mini App)
- Cross-system guard: cp2nus bootstrap rejects meters that belong to the cp2 system before initiating payment
- Analytics tracking and error capture throughout the flow

## Architecture

```
Telegram Bot (telegraf)
    │
    ├── /topup   → hostel selection → meter ID → amount → WebApp
    ├── /balance → meter ID → balance lookup
    └── /usage   → meter ID → 7-day usage
          │
          ▼
    Telegram WebApp (Express routes, mounted per hostel)
          │
          ├── GET  /webapp              — loading page; fetches meter summary from ORE
          ├── GET  /webapp/bootstrap    — runs full payment init, returns redirect URL
          ├── GET  /webapp/pay          — card entry page (RSA encryption in browser)
          ├── POST /webapp/enets_pay    — proxies encrypted card data to eNETS
          └── GET  /webapp/result       — final success/failure page
```

## Payment Flows

### CP2 — PGPR / Houses @ PGP / Residential Colleges / NUS College

Scrapes the EVS WebPOS portal to create a transaction, then proxies through eNETS.

1. **Loading page** — fetches meter address and balance from ORE in a single `getMeterSummary` call
2. **Bootstrap** (`/webapp/bootstrap`) — runs `runPurchaseFlow` and `getMeterSummary` in parallel via `Promise.all`:
   - `GET /EVSWebPOS/` → login → `POST /loginServlet` (meter validation)
   - `POST /selectOfferServlet` (amount selection)
   - `GET /paymentServlet` → extract `merchant_txn_ref` (follows redirects via custom `getFollowRedirects`)
   - `POST creditpayment.jsp` (120.50.44.233) → extract eNETS `message`
   - `POST /enets2/PaymentListener.do` → extract RSA public key (`n`, `e`), `netsMid`, `netsTxnRef`
3. **Card page** (`/webapp/pay`) — loads RSA scripts from `www.enets.sg`; encrypts `cardNo + cvv` client-side
4. **Payment proxy** (`/webapp/enets_pay`):
   - `POST https://www.enets.sg/GW2/uCredit/pay`
   - **Preferred path:** extracts EVS callback form from eNETS response HTML → `POST /EVSWebPOS/transSumServlet?status=&id=` → `parseEvsTransactionSummary`
   - **Fallback:** `parseEnetsResult` scrapes the eNETS receipt HTML directly
5. **Result page** — client-side redirect to `/webapp/result`

### CP2NUS — UTown Residence / RVRC

Uses the EVS JSON API and the eNETS Payment Page (enetspp) host directly.

1. **Loading page** — fetches meter address and balance from ORE via `getMeterSummary`
2. **Bootstrap** (`/webapp/bootstrap`) — `runBootstrap` runs sequentially:
   - **Meter system check** — `isCp2Meter()` guard: if the meter belongs to the cp2 system, returns `WRONG_SYSTEM` error immediately
   - **`init_pay`** — `POST /enets/init_pay` to EVS API → `{ txn_identifier, req, sign }`
   - **`meter_info`** — `getMeterSummary` → `buildPayDisplayAddress` (formats block/level/unit/building)
   - **`enetspp_pay`** — `buildEnetsPayUrl` base64-encodes `m/a/d/t/s` → `GET enetspp/pay?p=…` → extract `txnReq`, `keyId`, `hmac`
   - **`TxnReqListener`** — `POST /GW2/TxnReqListener` with `txnReq` JSON → returns RSA key, `netsTxnRef`, `netsMid` (top-level `UMID_xxx`), `paymtNetsMid` (acquiring MID from `paymtSvcInfoList[0]`), `txnRand`, `keyId`, `hmac`
3. **Card page** (`/webapp/pay`) — same RSA encryption as cp2; `paymtNetsMid` (not top-level `netsMid`) is passed to `panSubmitForm`; `expiryYear` passed as 4-digit string
4. **Payment proxy** (`/webapp/enets_pay`):
   - `GET /GW2/pluginpages/env.jsp` → seed `JSESSIONID` (`fetchEnvJsp`)
   - `POST /GW2/credit/init;jsessionid=…` with `paymentMode=CC_1, routeTo=FEH` (`callCreditInit`)
   - `POST /GW2/credit/panSubmitForm` with encrypted card data (`submitPanForm`)
   - **Preferred path:** `panSubmitForm` response message contains `netsTxnStatus` → `preParsed` result returned immediately (no b2s call needed)
   - **Fallback:** `POST /enets/b2s` (or action URL from `post_form`) → 303 redirect to `/pay_result?r=&t=&a=&x=&s=&m=` → `parsePayResult` base64-decodes all params
5. **Result page** — client-side redirect to `/webapp/result`

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A publicly accessible HTTPS server (required for Telegram WebApp buttons)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
SERVER_URL=https://your-public-server.example.com
OWNER_CHAT_ID=your_telegram_chat_id   # receives feedback notifications
```

`SERVER_URL` must be HTTPS for the Telegram WebApp payment button to work. If it is HTTP, the bot falls back to sending a plain browser link instead.

### Running

```bash
node bot.js      # Telegram bot (long-polling)
node server.js   # Express web server
```

## Bot Commands

| Command     | Description                       |
| ----------- | --------------------------------- |
| `/start`    | Show the main menu                |
| `/topup`    | Start an electricity top-up       |
| `/balance`  | Check meter balance               |
| `/usage`    | Show last 7 days of usage         |
| `/feedback` | Share feedback or report an issue |
| `/cancel`   | Cancel the current flow           |
| `/help`     | Show help and hostel information  |

## Bot Session Flow

Sessions are stored in-memory with a **15-minute TTL** and an `inFlight` guard to prevent duplicate requests. The top-up flow stages are:

```
idle
  → awaiting_hostel      (hostel keyboard: cp2 / cp2nus)
  → awaiting_meter_id    (8-digit meter ID + prefetch balance & 7-day usage)
  → awaiting_amount      ($6–$50 SGD)
  → idle                 (WebApp button shown)
```

The `/balance` and `/usage` commands use their own single-step stages (`awaiting_meter_id_balance`, `awaiting_meter_id_usage`) that return to idle after one response. The `/feedback` command uses `awaiting_feedback_rating` → `awaiting_feedback_text`, then notifies `OWNER_CHAT_ID`.

## Project Structure

```
├── bot.js                    # Telegram bot (Telegraf, long-polling)
├── server.js                 # Express app entry point
├── routes/
│   ├── cp2.js                # WebApp routes for cp2 (PGPR / PGP / RC / NUSC)
│   └── cp2nus.js             # WebApp routes for cp2nus (UTown / RVRC)
├── views/
│   ├── cp2.js                # HTML page templates for cp2
│   └── cp2nus.js             # HTML page templates for cp2nus
└── services/
    ├── cp2Service.js         # Purchase flow: EVS WebPOS scraping + eNETS proxy
    ├── cp2nusService.js      # Purchase flow: EVS JSON API + eNETS PP + NETS API
    ├── ore.js                # ORE API: meter summary and 7-day usage
    ├── utils.js              # HTML parsing helpers, result normalisation, XSS escaping
    ├── validators.js         # Meter ID and amount validation; isCp2Meter check
    ├── config.js             # Base URLs and shared HTTP headers
    └── analytics.js          # Event tracking and exception capture
```

## Notes

- Sessions are in-memory only — state is lost on bot restart.
- Card details are RSA-encrypted in the browser before being sent to the server. The server never sees plaintext card numbers or CVVs.
- The cp2nus flow distinguishes between the top-level `netsMid` (`UMID_xxx`, used in the card page) and `paymtNetsMid` (the acquiring MID from `paymtSvcInfoList[0]`, used in `panSubmitForm`). Using the wrong MID will cause the payment to fail.
- Minimum top-up: **$6.00 SGD** · Maximum: **$50.00 SGD**
