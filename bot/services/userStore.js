const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Railway Volume should be mounted at /data. Fall back to local for dev.
const DB_DIR = process.env.DB_DIR || (fs.existsSync("/data") ? "/data" : ".");
const DB_PATH = path.join(DB_DIR, "evs_users.db");

const db = new Database(DB_PATH);

// WAL mode: better concurrent read performance, safer on crashes
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id   TEXT PRIMARY KEY,
    meter_id  TEXT NOT NULL,
    hostel    TEXT NOT NULL,
    saved_at  INTEGER NOT NULL,
    last_seen INTEGER NOT NULL DEFAULT 0
  )
`);

/**
 * Save or overwrite a user's meter ID and hostel.
 * @param {string|number} chatId
 * @param {string} meterId   — 8-digit string
 * @param {string} hostel    — "cp2" | "cp2nus"
 */
function saveUser(chatId, meterId, hostel) {
  db.prepare(
    `
    INSERT INTO users (chat_id, meter_id, hostel, saved_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      meter_id = excluded.meter_id,
      hostel   = excluded.hostel,
      saved_at = excluded.saved_at
  `,
  ).run(String(chatId), meterId, hostel, Date.now());
}

function touchUser(chatId) {
  db.prepare(
    `
    UPDATE users SET last_seen = ? WHERE chat_id = ?
  `,
  ).run(Date.now(), String(chatId));
}

function getAllChatIds() {
  return db
    .prepare("SELECT chat_id FROM users")
    .all()
    .map((r) => r.chat_id);
}

function getActiveChatIds(windowMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  return db
    .prepare("SELECT chat_id FROM users WHERE last_seen >= ?")
    .all(cutoff)
    .map((r) => r.chat_id);
}

/**
 * Retrieve saved meter ID and hostel for a user.
 * @param {string|number} chatId
 * @returns {{ meterId: string, hostel: string } | null}
 */
function getUser(chatId) {
  const row = db
    .prepare("SELECT meter_id, hostel FROM users WHERE chat_id = ?")
    .get(String(chatId));

  return row ? { meterId: row.meter_id, hostel: row.hostel } : null;
}

/**
 * Delete saved meter ID and hostel for a user.
 * @param {string|number} chatId
 * @returns {boolean} true if a row was deleted
 */
function forgetUser(chatId) {
  const result = db
    .prepare("DELETE FROM users WHERE chat_id = ?")
    .run(String(chatId));
  return result.changes > 0;
}

module.exports = {
  saveUser,
  getUser,
  forgetUser,
  getAllChatIds,
  getActiveChatIds,
  touchUser,
};
