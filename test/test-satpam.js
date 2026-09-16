import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  calculateTimeoutDuration,
  containsEveryoneMention,
  isMemberExempt,
  loadConfig,
  notifyMemberPrivately,
  sendReportToAdminsAndOwner
} from '../src/satpam.js';
import { PermissionsBitField } from 'discord.js';
import { calculateHandlerPermissions } from '../src/handlerRole.js';
import {
  loadData,
  saveData,
  getUserRecord,
  recordMention,
  recordTimeoutApplied,
  resetUserRecord,
  cleanRecord
} from '../src/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataFile = path.resolve(__dirname, '../data/violations.json');

console.log('🧪 Memulai Pengujian Unit Bot Satpam...\n');

// Bersihkan data tes lama jika ada
if (fs.existsSync(testDataFile)) {
  fs.unlinkSync(testDataFile);
}

// 1. Uji deteksi mention @everyone
console.log('1. Menguji deteksi tag @everyone & @here...');
assert.strictEqual(containsEveryoneMention({ mentions: { everyone: true }, content: '' }), true);
assert.strictEqual(containsEveryoneMention({ mentions: { everyone: false }, content: 'halo @everyone apa kabar' }), true);
assert.strictEqual(containsEveryoneMention({ mentions: { everyone: false }, content: 'halo @here info meeting' }), true);
assert.strictEqual(containsEveryoneMention({ mentions: { everyone: false }, content: 'halo semua tanpa tag' }), false);
console.log('   ✅ Deteksi mention lolos pengujian.');

// 2. Uji perhitungan eskalasi durasi timeout
console.log('2. Menguji perhitungan durasi timeout...');
const mockConfig = {
  base_timeout_minutes: 15,
  increment_timeout_minutes: 15
};

// Timeout ke-1 (sebelumnya timeoutCount = 0): 15 menit
const t1 = calculateTimeoutDuration(0, mockConfig);
assert.strictEqual(t1.minutes, 15);
assert.strictEqual(t1.ms, 15 * 60 * 1000);

// Timeout ke-2 (sebelumnya timeoutCount = 1): 15 + 15 = 30 menit
const t2 = calculateTimeoutDuration(1, mockConfig);
assert.strictEqual(t2.minutes, 30);
assert.strictEqual(t2.ms, 30 * 60 * 1000);

// Timeout ke-3 (sebelumnya timeoutCount = 2): 15 + 30 = 45 menit
const t3 = calculateTimeoutDuration(2, mockConfig);
assert.strictEqual(t3.minutes, 45);
assert.strictEqual(t3.ms, 45 * 60 * 1000);

// Timeout ke-4 (sebelumnya timeoutCount = 3): 15 + 45 = 60 menit (1 jam)
const t4 = calculateTimeoutDuration(3, mockConfig);
assert.strictEqual(t4.minutes, 60);
console.log('   ✅ Perhitungan eskalasi durasi timeout lolos pengujian.');

// 3. Uji sistem penyimpanan pelanggaran & sliding window
console.log('3. Menguji pencatatan dan sliding window 24 jam...');
const guildId = 'guild_123';
const userId = 'user_456';

// Mention pertama
const m1 = recordMention(guildId, userId, 24);
assert.strictEqual(m1.countToday, 1);

// Mention kedua
const m2 = recordMention(guildId, userId, 24);
assert.strictEqual(m2.countToday, 2);

// Mention ketiga
const m3 = recordMention(guildId, userId, 24);
assert.strictEqual(m3.countToday, 3);

// Catat sanksi timeout pertama berhasil diterapkan
recordTimeoutApplied(guildId, userId, t1.ms, 24);

let rec = getUserRecord(guildId, userId, 24);
assert.strictEqual(rec.timeoutCount, 1);
assert.strictEqual(rec.history.length, 3);

// Mention ke-4 (pelanggaran berulang)
const m4 = recordMention(guildId, userId, 24);
assert.strictEqual(m4.countToday, 4);

// Simulasi kedaluwarsa 24 jam (timestamp 25 jam yang lalu)
const oldTime = Date.now() - (25 * 60 * 60 * 1000);
const expiredRecord = {
  userId: 'user_old',
  guildId: 'guild_123',
  history: [oldTime],
  timeoutCount: 2
};
const cleaned = cleanRecord(expiredRecord, 24);
assert.strictEqual(cleaned.history.length, 0);
assert.strictEqual(cleaned.timeoutCount, 0); // Reset otomatis setelah 24 jam bersih

// Uji reset command
const wasReset = resetUserRecord(guildId, userId);
assert.strictEqual(wasReset, true);
const recAfterReset = getUserRecord(guildId, userId, 24);
assert.strictEqual(recAfterReset.history.length, 0);
console.log('   ✅ Penyimpanan data, window 24 jam, dan reset lolos pengujian.');

// 4. Uji Pengecualian Admin / Bot
console.log('4. Menguji filter kebal admin/bot...');
const botMember = { user: { bot: true } };
assert.strictEqual(isMemberExempt(botMember, { exempt_admins: true }), true);

const ownerMember = {
  user: { bot: false },
  id: 'owner_1',
  guild: { ownerId: 'owner_1' },
  permissions: { has: () => false }
};
assert.strictEqual(isMemberExempt(ownerMember, { exempt_admins: true }), true);
console.log('   ✅ Filter kebal lolos pengujian.');

// 5. Uji Konfigurasi Mode Senyap & Notifikasi Privat
console.log('5. Menguji setelan konfigurasi mode senyap & privat...');
const currentConfig = loadConfig();
assert.strictEqual(currentConfig.stealth_mode, true);
assert.strictEqual(currentConfig.notify_violator_via_dm, true);
assert.strictEqual(currentConfig.notify_owner_via_dm, true);
assert.strictEqual(currentConfig.delete_violating_message, true);
console.log('   ✅ Konfigurasi mode senyap & notifikasi privat aktif.');

// 6. Uji pengiriman notifikasi privat (DM)
console.log('6. Menguji pengiriman notifikasi via DM...');
let dmSent = false;
const mockMemberWithDm = {
  id: 'member_dm',
  send: async (payload) => {
    dmSent = true;
    return payload;
  }
};
const success = await notifyMemberPrivately(mockMemberWithDm, {}, { title: 'Test' }, 'test fallback');
assert.strictEqual(success, true);
assert.strictEqual(dmSent, true);

// Simulasi fallback jika member mematikan DM
const mockMemberClosedDm = {
  id: 'member_nodm',
  send: async () => {
    throw new Error('Cannot send messages to this user');
  }
};
let channelMsgSent = false;
const mockChannel = {
  send: async (payload) => {
    channelMsgSent = true;
    return { delete: async () => {} };
  }
};
const fallbackSuccess = await notifyMemberPrivately(mockMemberClosedDm, mockChannel, { title: 'Test' }, 'test fallback');
assert.strictEqual(fallbackSuccess, false);
assert.strictEqual(channelMsgSent, true);
console.log('   ✅ Mekanisme DM dan fallback tertutup lolos pengujian.');

// 7. Uji kalkulasi hak akses role BOT HANDLER (Semua izin kecuali Administrator)
console.log('7. Menguji kalkulasi permissions BOT HANDLER...');
const mockGuildWithAdminBot = {
  members: {
    me: {
      permissions: {
        has: (flag) => flag === PermissionsBitField.Flags.Administrator
      }
    }
  }
};
const calculatedBits = calculateHandlerPermissions(mockGuildWithAdminBot);
const permField = new PermissionsBitField(calculatedBits);

// Administrator harus FALSE
assert.strictEqual(permField.has(PermissionsBitField.Flags.Administrator), false, 'Administrator harus bernilai FALSE');
// Hak akses krusial lainnya harus TRUE
assert.strictEqual(permField.has(PermissionsBitField.Flags.ManageGuild), true, 'ManageGuild harus bernilai TRUE');
assert.strictEqual(permField.has(PermissionsBitField.Flags.ModerateMembers), true, 'ModerateMembers harus bernilai TRUE');
assert.strictEqual(permField.has(PermissionsBitField.Flags.KickMembers), true, 'KickMembers harus bernilai TRUE');
assert.strictEqual(permField.has(PermissionsBitField.Flags.BanMembers), true, 'BanMembers harus bernilai TRUE');
assert.strictEqual(permField.has(PermissionsBitField.Flags.ManageRoles), true, 'ManageRoles harus bernilai TRUE');
assert.strictEqual(permField.has(PermissionsBitField.Flags.MentionEveryone), true, 'MentionEveryone harus bernilai TRUE');
console.log('   ✅ Hak akses BOT HANDLER (semua aktif kecuali Administrator) lolos pengujian.');

// 8. Uji Pengecualian Member dengan Role BOT HANDLER
console.log('8. Menguji pengecualian (exempt) untuk role BOT HANDLER...');
const handlerMember = {
  id: 'handler_user_1',
  user: { bot: false },
  guild: { ownerId: 'other_owner' },
  roles: {
    cache: [
      { name: 'BOT HANDLER' }
    ]
  },
  permissions: {
    has: () => false
  }
};
assert.strictEqual(isMemberExempt(handlerMember, { exempt_admins: false }), true, 'Pemilik role BOT HANDLER wajib kebal sanksi');
console.log('   ✅ Member dengan role BOT HANDLER terbukti kebal sanksi satpam.');

// 9. Uji Pengiriman Laporan ke Channel Log Admin
console.log('9. Menguji pengiriman laporan ke channel log admin...');
let adminChannelSent = false;
let sentPayload = null;
const mockAdminLogGuild = {
  channels: {
    cache: {
      get: () => null,
      find: (predicate) => {
        const fakeChannel = {
          name: 'satpam-log',
          isTextBased: () => true,
          permissionsFor: () => ({
            has: () => true
          }),
          send: async (payload) => {
            adminChannelSent = true;
            sentPayload = payload;
            return payload;
          }
        };
        return predicate(fakeChannel) ? fakeChannel : null;
      }
    },
    fetch: async () => null
  },
  members: {
    me: {
      permissions: {
        has: () => true
      }
    }
  }
};

await sendReportToAdminsAndOwner(
  {},
  mockAdminLogGuild,
  { title: 'Laporan Pelanggaran' },
  [{ type: 1 }],
  {
    admin_notifications: {
      channel_name_or_id: 'satpam-log',
      notify_admins_via_dm: false
    },
    notify_owner_via_dm: false
  }
);

assert.strictEqual(adminChannelSent, true, 'Laporan harus sukses terkirim ke channel admin log');
assert.strictEqual(sentPayload.components.length, 1, 'Komponen tombol buka timeout harus terkirim');
console.log('   ✅ Pengiriman laporan & tombol interaktif ke channel admin log lolos pengujian.');

console.log('\n🎉 SEMUA PENGUJIAN BERHASIL (100% PASS)!');


