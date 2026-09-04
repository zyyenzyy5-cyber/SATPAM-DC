import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'violations.json');

/**
 * Pastikan direktori data ada
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Membaca data pelanggaran dari violations.json
 * @returns {Record<string, { userId: string, guildId: string, history: number[], timeoutCount: number, lastTimeoutAt: number }>}
 */
export function loadData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Storage] Gagal membaca violations.json, menggunakan data kosong:', err.message);
    return {};
  }
}

/**
 * Menyimpan data ke file violations.json secara aman
 * @param {Record<string, any>} data
 */
export function saveData(data) {
  ensureDataDir();
  try {
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('[Storage] Gagal menyimpan data ke violations.json:', err.message);
  }
}

/**
 * Membersihkan riwayat mention yang sudah lewat dari jendela waktu (default 24 jam)
 * @param {any} record
 * @param {number} windowHours
 * @returns {any}
 */
export function cleanRecord(record, windowHours = 24) {
  if (!record) return null;
  const cutoff = Date.now() - (windowHours * 60 * 60 * 1000);
  const validHistory = (record.history || []).filter(ts => ts > cutoff);

  // Jika semua riwayat sudah expired, reset juga counter timeout
  const timeoutCount = validHistory.length === 0 ? 0 : (record.timeoutCount || 0);

  return {
    ...record,
    history: validHistory,
    timeoutCount
  };
}

/**
 * Mengambil record pelanggaran pengguna
 * @param {string} guildId
 * @param {string} userId
 * @param {number} windowHours
 */
export function getUserRecord(guildId, userId, windowHours = 24) {
  const data = loadData();
  const key = `${guildId}:${userId}`;
  const rawRecord = data[key];
  if (!rawRecord) {
    return {
      userId,
      guildId,
      history: [],
      timeoutCount: 0,
      lastTimeoutAt: 0
    };
  }
  return cleanRecord(rawRecord, windowHours);
}

/**
 * Mencatat satu kali mention @everyone untuk pengguna
 * @param {string} guildId
 * @param {string} userId
 * @param {number} windowHours
 * @returns {{ record: any, countToday: number }}
 */
export function recordMention(guildId, userId, windowHours = 24) {
  const data = loadData();
  const key = `${guildId}:${userId}`;
  let record = getUserRecord(guildId, userId, windowHours);

  const now = Date.now();
  record.history.push(now);

  data[key] = record;
  saveData(data);

  return {
    record,
    countToday: record.history.length
  };
}

/**
 * Mencatat sanksi timeout yang baru saja diberikan
 * @param {string} guildId
 * @param {string} userId
 * @param {number} durationMs
 * @param {number} windowHours
 * @returns {any}
 */
export function recordTimeoutApplied(guildId, userId, durationMs, windowHours = 24) {
  const data = loadData();
  const key = `${guildId}:${userId}`;
  let record = getUserRecord(guildId, userId, windowHours);

  record.timeoutCount = (record.timeoutCount || 0) + 1;
  record.lastTimeoutAt = Date.now();
  record.lastTimeoutDurationMs = durationMs;

  data[key] = record;
  saveData(data);

  return record;
}

/**
 * Mereset status pelanggaran seorang user (untuk command admin)
 * @param {string} guildId
 * @param {string} userId
 */
export function resetUserRecord(guildId, userId) {
  const data = loadData();
  const key = `${guildId}:${userId}`;
  if (data[key]) {
    delete data[key];
    saveData(data);
    return true;
  }
  return false;
}
