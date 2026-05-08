const {
  STAGES,
  HOSTELS,
  HOSTEL_LABELS,
  cancelKeyboard,
  hostelInlineKeyboard,
} = require("../constants");
const { getSession, resetSession } = require("./session");
const { getUser } = require("./userStore");

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

function getHostelLabel(hostel) {
  return HOSTEL_LABELS[hostel] ?? HOSTEL_LABELS[HOSTELS.CP2];
}

function getWebAppPath(hostel) {
  return hostel === HOSTELS.CP2NUS ? "/cp2nus/webapp" : "/webapp";
}

function isHttpsUrl(url) {
  try {
    return new URL(String(url)).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Initialises a top-up session, reusing any saved meter ID / hostel.
 * Returns the session (already mutated) so the caller can inspect the stage.
 *
 * savedInSession — meter ID from a deep-link that was stashed before reset.
 */
function startTopUp(chatId, savedInSession = null) {
  resetSession(chatId);
  const session = getSession(chatId);

  const dbUser = getUser(chatId);
  const meterId = savedInSession ?? dbUser?.meterId ?? null;
  const hostel = dbUser?.hostel ?? null;

  if (meterId) session.txtMtrId = meterId;
  if (hostel) session.hostel = hostel;

  session.stage =
    session.txtMtrId && session.hostel
      ? STAGES.AWAITING_AMOUNT
      : STAGES.AWAITING_HOSTEL;

  return session;
}

/**
 * Sends the appropriate first message for a top-up flow.
 * Handles three cases:
 *   1. Both meter ID and hostel saved → jump straight to amount
 *   2. Only meter ID saved → ask hostel
 *   3. Nothing saved → ask hostel
 */
async function handleTopUpStart(ctx, chatId) {
  const session = startTopUp(chatId, null);

  if (session.stage === STAGES.AWAITING_AMOUNT) {
    return ctx.reply(
      `🔌 Using saved Meter ID: <code>${session.txtMtrId}</code>\n` +
        `🏠 Hostel: <b>${getHostelLabel(session.hostel)}</b>\n\n` +
        `Enter the amount in SGD (min $6, max $50), or tap ❌ Cancel to start over.\n\n` +
        `💡 Use /forget to clear your saved details.`,
      { parse_mode: "HTML", ...cancelKeyboard },
    );
  }

  if (session.txtMtrId) {
    return ctx.reply(
      `🔌 Using saved Meter ID: <code>${session.txtMtrId}</code>\n\n` +
        `🏠 Please select your hostel:`,
      { parse_mode: "HTML", reply_markup: hostelInlineKeyboard.reply_markup },
    );
  }

  return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard);
}

module.exports = {
  SERVER_URL,
  getHostelLabel,
  getWebAppPath,
  isHttpsUrl,
  startTopUp,
  handleTopUpStart,
};
