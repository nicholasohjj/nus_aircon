const { Markup } = require("telegraf");

// ── Session stages ────────────────────────────────────────────────────────────
const STAGES = {
  IDLE: "idle",
  AWAITING_HOSTEL: "awaiting_hostel",
  AWAITING_METER_ID: "awaiting_meter_id",
  AWAITING_METER_ID_BALANCE: "awaiting_meter_id_balance",
  AWAITING_METER_ID_USAGE: "awaiting_meter_id_usage",
  AWAITING_AMOUNT: "awaiting_amount",
  AWAITING_PAYMENT: "awaiting_payment",
  AWAITING_FEEDBACK_RATING: "awaiting_feedback_rating",
  AWAITING_FEEDBACK_TEXT: "awaiting_feedback_text",
};

// ── Hostels ───────────────────────────────────────────────────────────────────
const HOSTELS = {
  CP2: "cp2",
  CP2NUS: "cp2nus",
};

const HOSTEL_LABELS = {
  [HOSTELS.CP2]:
    "PGPR / Houses @ PGP / Residential Colleges / NUS College (cp2)",
  [HOSTELS.CP2NUS]: "UTown Residence / RVRC (cp2nus)",
};

// ── TTLs ──────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PENDING_REPLY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Keyboards ─────────────────────────────────────────────────────────────────
const mainKeyboard = Markup.keyboard([
  ["⚡ Top Up"],
  ["💰 Balance", "📊 Usage"],
  ["ℹ️ Help"],
]).resize();

const cancelKeyboard = Markup.keyboard([["❌ Cancel"]]).resize();

const hostelInlineKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🏠 PGPR / PGP / RC / NUSC (cp2)", "hostel_cp2")],
  [
    Markup.button.callback(
      "🏠 UTown Residence / RVRC (cp2nus)",
      "hostel_cp2nus",
    ),
  ],
]);

function ratingKeyboard() {
  return Markup.keyboard([
    ["⭐ 1", "⭐⭐ 2", "⭐⭐⭐ 3", "⭐⭐⭐⭐ 4", "⭐⭐⭐⭐⭐ 5"],
    ["❌ Cancel"],
  ]).resize();
}

const TOPUP_DISABLED_MESSAGE =
  "⚠️ Top-ups are temporarily unavailable.\n\n" +
  "EVS is currently having a vendor-side issue where completed top-ups may not update the meter balance properly.\n\n" +
  "For now, please use the official EVS portal for urgent top-ups, and use /balance here to check your current balance.";

const TOPUP_IN_PROGRESS_STAGES = new Set([
  STAGES.AWAITING_HOSTEL,
  STAGES.AWAITING_METER_ID,
  STAGES.AWAITING_AMOUNT,
  STAGES.AWAITING_PAYMENT,
]);

module.exports = {
  STAGES,
  HOSTELS,
  HOSTEL_LABELS,
  SESSION_TTL_MS,
  PENDING_REPLY_TTL_MS,
  mainKeyboard,
  cancelKeyboard,
  hostelInlineKeyboard,
  ratingKeyboard,
  TOPUP_DISABLED_MESSAGE,
  TOPUP_IN_PROGRESS_STAGES,
};
