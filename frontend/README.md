# Frontend — EVS Electricity Top-Up

React + Vite frontend for the EVS electricity top-up web app. Served at `/app/` by the Express backend in production.

## Pages

| Route             | Component         | Description                                             |
| ----------------- | ----------------- | ------------------------------------------------------- |
| `/`               | `HomePage`        | Hostel selection, meter ID, and amount entry            |
| `/loading`        | `LoadingPage`     | Calls `/webapp/bootstrap`; shows progress               |
| `/pay`            | `CardPaymentPage` | RSA-encrypted card form; submits to `/webapp/enets_pay` |
| `/result`         | `ResultPage`      | Payment outcome; reads from server session              |
| `/cp2nus/loading` | `LoadingPage`     | cp2nus variant (UTown / RVRC)                           |
| `/cp2nus/pay`     | `CardPaymentPage` | cp2nus variant                                          |
| `/cp2nus/result`  | `ResultPage`      | cp2nus variant                                          |

## Structure

```
frontend/
├── src/
│   ├── App.jsx                  # React Router route definitions
│   ├── pages/
│   │   ├── HomePage.jsx         # Hostel + meter ID + amount; amount presets
│   │   ├── LoadingPage.jsx      # Polling spinner; retry on failure
│   │   ├── CardPaymentPage.jsx  # Card form with RSA encryption
│   │   └── ResultPage.jsx       # Success / failure with detail rows
│   ├── components/
│   │   ├── Card.jsx             # Card, DetailRow, Logo wrappers
│   │   └── ErrorCard.jsx        # Inline error + retry button
│   └── lib/
│       ├── rsa.js               # Client-side RSA encryption (jsbn)
│       ├── cardBrand.js         # Visa / Mastercard detection + formatting
│       └── validation.js        # Card form field validation
└── __tests__/                   # Vitest + Testing Library tests
```

## Key behaviours

**Card encryption** — `CardPaymentPage` encrypts the card number and CVV using the RSA public key (`n`/`e` for cp2, `rsaModulus`/`rsaExponent` for cp2nus) fetched from the server session. The server never receives plaintext card data.

**Session token** — all pages receive a short-lived opaque `token` via query param. The token is used to fetch session data (`/webapp/session?token=`) and to submit payment. Payment results are read from the server session — query params are never trusted for outcome data.

**Telegram Mini App** — pages call `window.Telegram.WebApp.ready()` and `.expand()` on mount when running inside Telegram. The result page's Close button calls `window.Telegram.WebApp.close()` after posting a notify request to the backend.

**cp2 vs cp2nus** — `CardPaymentPage` and `ResultPage` accept a `basePath` prop (`""` for cp2, `"/cp2nus"` for cp2nus). All fetch calls are prefixed with `basePath` so the same component works for both flows.

## Development

```bash
# From the project root
npm run dev:frontend   # Vite dev server on :5173

# Or from this directory
npm run dev
```

The Vite config proxies `/webapp` and `/cp2nus` to the Express backend on `:3000`, so both flows work during local development without CORS issues.

## Building

```bash
# From the project root
npm run build:frontend

# Or from this directory
npm run build
```

Output goes to `frontend/dist/`. Express serves this directory at `/app/` in production.

## Testing

```bash
npm test          # Vitest (watch mode)
npm run test:run  # Single run (CI)
```

Tests use Vitest and Testing Library. Components are tested against the React Router context they expect in production.
