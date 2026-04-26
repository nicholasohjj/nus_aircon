# EVS Electricity Top-Up Bot

A Telegram bot and web server that lets NUS hostel residents top up their EVS electricity meters via credit card, without needing to visit a physical terminal.

## Supported Hostels

| Hostel Group | EVS System |
|---|---|
| PGPR, Houses @ PGP, Residential Colleges, NUS College | `cp2.evs.com.sg` |
| UTown Residence, RVRC | `cp2nus.evs.com.sg` |

## Features

- Check meter balance and 7-day usage history from within Telegram
- Top up electricity via credit card (SGD $6–$50)
- RSA-encrypted card entry in a Telegram WebApp (Mini App)
- In-session meter validation against the correct EVS system before payment
- Analytics tracking and error capture throughout the flow

## Architecture

```
Telegram Bot (telegraf)
    │
    ├── /topup → hostel selection → meter ID → amount
    ├── /balance → meter ID → balance lookup
    └── /usage  → meter ID → 7-day usage
          │
          ▼
    Telegram WebApp (express routes)
          │
          ├── GET  /webapp          — loading page (cp2 / cp2nus)
          ├── GET  /webapp/bootstrap — runs full payment init flow, returns redirect URL
          ├── GET  /webapp/pay       — card entry page (RSA encryption in browser)
          ├── POST /webapp/enets_pay — proxies encrypted card data to eNETS
          └── GET  /webapp/result    — final success/failure page
```

### Payment Flow

**CP2 (PGPR / PGP / RC / NUSC)**
1. Logs into EVS WebPOS, selects offer, retrieves `merchant_txn_ref`
2. Calls eNETS `creditpayment.jsp` to get eNETS fields
3. User submits RSA-encrypted card details
4. Server proxies to eNETS `uCredit/pay`, then posts result back to EVS `transSumServlet`

**CP2NUS (UTown / RVRC)**
1. Calls EVS `enets/init_pay` to create a transaction
2. Fetches RSA public key and HMAC token via eNETS `TxnReqListener`
3. User submits RSA-encrypted card details
4. Server calls eNETS `credit/init` + `panSubmitForm`, then posts to EVS `b2s`

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
```

`SERVER_URL` must be an HTTPS URL for the Telegram WebApp payment button to work. If it is HTTP, the bot will fall back to sending a plain browser link instead.

### Running

```bash
node bot.js        # Start the Telegram bot (polling)
node server.js     # Start the Express web server
```

Or run both together if you have a combined entry point.

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Show the main menu |
| `/topup` | Start an electricity top-up |
| `/balance` | Check meter balance |
| `/usage` | Show last 7 days of usage |
| `/cancel` | Cancel the current flow |
| `/help` | Show help information |

## Project Structure

```
├── bot.js                  # Telegram bot (Telegraf)
├── routes/
│   ├── cp2.js              # Express routes for cp2 (PGPR / PGP / RC / NUSC)
│   └── cp2nus.js           # Express routes for cp2nus (UTown / RVRC)
└── services/
    ├── ore.js              # Meter summary and usage API calls
    ├── vars.js             # Validation helpers (meter ID, amount, system check)
    └── analytics.js        # Event tracking and exception capture
```

## Notes

- Sessions are stored in memory with a 15-minute TTL. The bot will lose session state on restart.
- Card details are RSA-encrypted in the browser before being sent to the server — the server never sees plaintext card numbers.
- The minimum top-up amount is **$6.00 SGD** and the maximum is **$50.00 SGD**.