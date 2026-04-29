const { randomBytes } = require("crypto");

const store = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function createPaymentSession(data) {
  const token = randomBytes(32).toString("hex");
  store.set(token, { ...data, createdAt: Date.now() });
  return token;
}

function consumePaymentSession(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(token);
    return null;
  }
  store.delete(token); // single-use
  return entry;
}

function getPaymentSession(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(token);
    return null;
  }
  return entry;
}

// Periodic cleanup to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of store.entries()) {
    if (now - entry.createdAt > TTL_MS) store.delete(token);
  }
}, TTL_MS);

module.exports = {
  createPaymentSession,
  consumePaymentSession,
  getPaymentSession,
};
