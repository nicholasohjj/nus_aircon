# EVS Electricity Top-Up

A Telegram bot and web app that lets NUS hostel residents top up their EVS electricity meters via credit card, without needing to visit a physical terminal.

## Supported hostels

| Hostel group                                          | EVS system          |
| ----------------------------------------------------- | ------------------- |
| PGPR, Houses @ PGP, Residential Colleges, NUS College | `cp2.evs.com.sg`    |
| UTown Residence, RVRC                                 | `cp2nus.evs.com.sg` |

## Features

- Check meter balance and 7-day usage history from within Telegram
- Top up electricity via credit card (SGD $6–$50)
- RSA-encrypted card entry — card details never leave the browser in plaintext
- Works as a Telegram Mini App and as a standalone website
- Cross-system guard: cp2nus bootstrap rejects meters that belong to the cp2 system before initiating payment
- Analytics tracking and error capture throughout the flow

## Architecture

```
Telegram Bot (telegraf)          Website (React, /app/)
    │                                │
    ├── /topup                       └── HomePage
    ├── /balance                          └── hostel selection
    └── /usage                                + meter ID + amount
          │                                       │
          ▼                                       ▼
    Express (server.js)  ←────────────────────────────
          │
          ├── GET  /webapp              — fetches meter summary, redirects to React
          ├── GET  /webapp/bootstrap    — runs full payment init, returns token
          ├── GET  /webapp/session      — returns session data as JSON for React
          ├── GET  /webapp/pay          — redirects to React card entry page
          ├── POST /webapp/enets_pay    — proxies encrypted card data to eNETS
          ├── POST /webapp/notify       — sends payment result to Telegram chat
          └── GET  /webapp/result       — redirects to React result page

    React Frontend (/app/)
          ├── /                 — HomePage (hostel + meter ID + amount)
          ├── /loading          — LoadingPage (calls /webapp/bootstrap)
          ├── /pay              — CardPaymentPage (RSA encryption + submit)
          ├── /result           — ResultPage (outcome from server session)
          ├── /cp2nus/loading   — cp2nus variant
          ├── /cp2nus/pay       — cp2nus variant
          └── /cp2nus/result    — cp2nus variant
```

## Payment flows

### CP2 — PGPR / Houses @ PGP / Residential Colleges / NUS College

Scrapes the EVS WebPOS portal to create a transaction, then proxies through eNETS.

1. **`/webapp`** — fetches meter address and balance from ORE, redirects to React loading page with address/balance in query params
2. **Bootstrap** (`/webapp/bootstrap`) — runs `runPurchaseFlow` and `getMeterSummary` in parallel:
   - `GET /EVSWebPOS/` → login → `POST /loginServlet` (meter validation)
   - `POST /selectOfferServlet` (amount selection)
   - `GET /paymentServlet` → extract `merchant_txn_ref`
   - `POST creditpayment.jsp` → extract eNETS `message`
   - `POST /enets2/PaymentListener.do` → extract RSA public key (`n`, `e`), `netsMid`, `netsTxnRef`
   - Creates a payment session (10-min TTL), redirects to React card page
3. **Card page** (`/app/pay`) — React component; fetches session via `/webapp/session`; encrypts `cardNo + cvv` with eNETS RSA scripts client-side
4. **Payment proxy** (`/webapp/enets_pay`):
   - `POST https://www.enets.sg/GW2/uCredit/pay`
   - **Preferred path:** extracts EVS callback form → `POST /EVSWebPOS/transSumServlet` → `parseEvsTransactionSummary`
   - **Fallback:** `parseEnetsResult` scrapes the eNETS receipt HTML directly
   - Writes outcome (`status`, `merchantTxnRef`, `reason`) back to the server-side session
5. **Result page** (`/app/result`) — React component; reads outcome from server session via `/webapp/session`

### CP2NUS — UTown Residence / RVRC

Uses the EVS JSON API and the eNETS Payment Page (enetspp) host directly.

1. **`/webapp`** — same as cp2; fetches meter info, redirects to `/app/cp2nus/loading`
2. **Bootstrap** (`/cp2nus/webapp/bootstrap`) — `runBootstrap` runs sequentially:
   - **Meter system check** — `isCp2Meter()` guard: rejects cp2 meters with a `WRONG_SYSTEM` error; on network failure the check is skipped and flow proceeds
   - **`init_pay`** — `POST /enets/init_pay` → `{ txn_identifier, req, sign }`
   - **`meter_info`** — `getMeterSummary` → `buildPayDisplayAddress`
   - **`enetspp_pay`** — `buildEnetsPayUrl` → `GET enetspp/pay?p=…` → extract `txnReq`, `keyId`, `hmac`
   - **`TxnReqListener`** — `POST /GW2/TxnReqListener` → RSA key, `netsTxnRef`, `netsMid`, `paymtNetsMid`, `txnRand`, `keyId`, `hmac`
3. **Card page** (`/app/cp2nus/pay`) — same RSA encryption; `paymtNetsMid` (acquiring MID) used in `panSubmitForm`, not top-level `netsMid`
4. **Payment proxy** (`/cp2nus/webapp/enets_pay`):
   - `GET /GW2/pluginpages/env.jsp` → seed `JSESSIONID`
   - `POST /GW2/credit/init;jsessionid=…`
   - `POST /GW2/credit/panSubmitForm`
   - **Preferred path:** `netsTxnStatus` in response → `preParsed` result (no b2s call)
   - **Fallback:** `POST /enets/b2s` → 303 redirect → `parsePayResult` base64-decodes params
5. **Result page** (`/app/cp2nus/result`) — reads outcome from server session

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A publicly accessible HTTPS server (required for Telegram WebApp buttons)

### Installation

```bash
# Install backend dependencies
npm install

# Install and build the frontend
npm run build:frontend
```

### Environment variables

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
SERVER_URL=https://your-public-server.example.com
OWNER_CHAT_ID=your_telegram_chat_id   # receives feedback notifications
TOPUP_DISABLED=false                  # set to "true" to show maintenance message
DB_DIR=/data                          # directory for SQLite user store (default: /data if it exists, else .)
```

`SERVER_URL` must be HTTPS for the Telegram WebApp payment button to work. If it is HTTP, the bot falls back to a plain browser link instead.

### Running

```bash
# Development (two terminals)
npm run dev            # Express backend on :3000
npm run dev:frontend   # Vite dev server on :5173

# Production
npm run build:frontend
npm start
```

The frontend is served at `/app/` by Express in production. In development, Vite proxies `/webapp` and `/cp2nus` to the backend.

### Testing

```bash
# Backend tests
npm test

# Frontend tests
cd frontend && npm test
```

## Bot commands

| Command     | Description                       |
| ----------- | --------------------------------- |
| `/start`    | Show the main menu                |
| `/topup`    | Start an electricity top-up       |
| `/balance`  | Check meter balance               |
| `/usage`    | Show last 7 days of usage         |
| `/feedback` | Share feedback or report an issue |
| `/cancel`   | Cancel the current flow           |
| `/help`     | Show help and hostel information  |

## Bot session flow

Sessions are stored in-memory with a **15-minute TTL**. All messages for a given chat are serialised through a per-chat lock to prevent race conditions. The top-up flow stages are:

```
idle
  → awaiting_hostel            (cp2 / cp2nus inline keyboard)
  → awaiting_meter_id          (8-digit ID; prefetches balance + 7-day usage)
  → awaiting_amount            ($6–$50 SGD)
  → awaiting_payment           (WebApp Pay button; re-prompts on text)
  → idle                       (reset after WebApp closes)

  → awaiting_meter_id_balance  (/balance with no saved meter)
  → awaiting_meter_id_usage    (/usage with no saved meter)

  → awaiting_feedback_rating   (/feedback — star rating keyboard)
  → awaiting_feedback_text     (free-text or ⏭ Skip)
  → idle
```

`/balance` and `/usage` use single-step stages that return to idle after one response.

## Payment session

Payment sessions (created by `/webapp/bootstrap`) are stored in-memory with a **10-minute TTL**, separate from bot sessions. The session holds the meter ID, amount, address, balance, eNETS keys, and the payment outcome once complete. The React frontend reads outcome data from the session via `GET /webapp/session?token=` — query params are never trusted for payment results.

## User store

Saved meter IDs and hostels are persisted in a SQLite database (`evs_users.db`) using `better-sqlite3`. The database is written to `DB_DIR` (Railway Volume at `/data` if present, otherwise the project root). Unlike bot sessions and payment sessions, the user store survives restarts.

## Owner reply threading

When a user submits feedback, the bot forwards a notification to `OWNER_CHAT_ID`. The owner can reply directly to that Telegram notification and the bot forwards the reply back to the user. Reply threads are tracked via an in-memory `pendingReplies` map with a 7-day TTL.

Note: threading only follows the original notification message. If the owner replies to their own reply, that message is not automatically routed back to the user — only replies to the original forwarded notification are intercepted.

## Project structure

```
├── server.js                        # Express entry point; serves React at /app/
├── routes/
│   ├── cp2.js                    # WebApp + API routes for cp2
│   └── cp2nus.js                 # WebApp + API routes for cp2nus
├── services/
│   ├── cp2Service.js             # Purchase flow: EVS WebPOS scraping + eNETS proxy
│   ├── cp2nusService.js          # Purchase flow: EVS JSON API + eNETS PP + NETS API
│   ├── errorPage.js              # Shared HTML error page for Express error responses
│   ├── ore.js                    # ORE API: meter summary and usage history
│   ├── paymentSession.js         # In-memory payment session store (10-min TTL)
│   ├── utils.js                  # HTML parsing, result normalisation, XSS escaping
│   ├── validators.js             # Meter ID and amount validation
│   ├── config.js                 # Base URLs and shared HTTP headers
│   └── analytics.js              # Event tracking and exception capture
├── bot/
│   ├── index.js                  # Telegraf bot setup and handler registration
│   ├── handlers/                 # Command and text message handlers
│   ├── services/                 # Bot session, user store, lookup helpers
│   └── constants.js              # Stage names, keyboards, shared messages
└── frontend/                     # React + Vite frontend
    ├── src/
    │   ├── App.jsx               # React Router routes
    │   ├── pages/
    │   │   ├── HomePage.jsx      # Hostel selection + meter ID + amount entry
    │   │   ├── LoadingPage.jsx   # Spinner; calls /webapp/bootstrap
    │   │   ├── CardPaymentPage.jsx  # RSA card form; calls /webapp/enets_pay
    │   │   └── ResultPage.jsx    # Payment outcome
    │   ├── components/           # Card, DetailRow, Logo, ErrorCard
    │   └── lib/                  # rsa.js, cardBrand.js, validation.js
    └── __tests__/                # Vitest + Testing Library tests
```

## Notes

- Bot sessions and payment sessions are in-memory — state is lost on restart. Payment sessions expire after 10 minutes; bot sessions after 15 minutes. The user store (saved meter IDs) is SQLite-backed and persists across restarts.
- Card details are RSA-encrypted in the browser before being sent to the server. The server never sees plaintext card numbers or CVVs.
- The cp2nus flow distinguishes between the top-level `netsMid` (`UMID_xxx`) and `paymtNetsMid` (acquiring MID from `paymtSvcInfoList[0]`). Using the wrong MID will cause the payment to fail silently.
- Minimum top-up: **$6.00 SGD** · Maximum: **$50.00 SGD**
- The website entry point (`/app/`) and the Telegram Mini App use the same Express routes and React pages — no separate codepaths.
- Top-ups can be disabled at runtime with `/topupoff` (owner command) or at startup with `TOPUP_DISABLED=true`. Users in an active top-up session when the flag is set will have their session reset and see the maintenance message.
