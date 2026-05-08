const { SESSION_TTL_MS } = require("../constants");

// ── In-memory session store ───────────────────────────────────────────────────
// chatId (string|number) → { stage, hostel?, txtMtrId?, amountDollars?, amountCents?,
//                             webAppUrl?, feedbackRating?, updatedAt }
const sessions = {};

// Prune expired sessions every SESSION_TTL_MS
setInterval(() => {
  const now = Date.now();
  for (const chatId of Object.keys(sessions)) {
    if (now - (sessions[chatId].updatedAt ?? 0) > SESSION_TTL_MS) {
      delete sessions[chatId];
    }
  }
}, SESSION_TTL_MS).unref();

/**
 * Returns the live session object for chatId, creating/resetting it if
 * it doesn't exist or has expired. Always touches updatedAt.
 */
function getSession(chatId) {
  const now = Date.now();
  const s = sessions[chatId];

  if (!s || now - (s.updatedAt ?? 0) > SESSION_TTL_MS) {
    sessions[chatId] = { stage: "idle", updatedAt: now };
  } else {
    sessions[chatId].updatedAt = now;
  }

  return sessions[chatId];
}

/** Hard-reset a session to idle, discarding all pending state. */
function resetSession(chatId) {
  sessions[chatId] = { stage: "idle", updatedAt: Date.now() };
}

// ── Per-chat concurrency lock ─────────────────────────────────────────────────
// Ensures only one handler runs at a time per chat, queuing the rest.
const chatLocks = new Map();
const chatWaiters = new Map(); // chatId → number of active + queued handlers

async function withChatLock(chatId, fn) {
  chatWaiters.set(chatId, (chatWaiters.get(chatId) ?? 0) + 1);

  const prev = chatLocks.get(chatId) ?? Promise.resolve();
  let release;
  const next = new Promise((res) => (release = res));
  chatLocks.set(
    chatId,
    prev.then(() => next),
  );

  try {
    await prev;
    return await fn();
  } finally {
    release();

    const remaining = (chatWaiters.get(chatId) ?? 1) - 1;
    if (remaining <= 0) {
      chatWaiters.delete(chatId);
      chatLocks.delete(chatId);
    } else {
      chatWaiters.set(chatId, remaining);
    }
  }
}

module.exports = { getSession, resetSession, withChatLock };
