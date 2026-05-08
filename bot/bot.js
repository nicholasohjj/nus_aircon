require("dotenv").config();
const { Telegraf } = require("telegraf");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN env var is required");

const bot = new Telegraf(TOKEN);

// ── Mutable runtime state ─────────────────────────────────────────────────────
// Exported as a single object so mutations are visible to all importers.
const state = {
  topupDisabled: process.env.TOPUP_DISABLED === "true",
};

// pendingReplies: messageId → { chatId, ownerMsgId, createdAt }
// Tracks in-flight owner↔user reply threads across the 7-day TTL.
const pendingReplies = new Map();

module.exports = { bot, state, pendingReplies };
