import {
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUserRecord, recordMention, recordTimeoutApplied, resetUserRecord } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Membaca konfigurasi dari config.json
 */
export function loadConfig() {
  const configPath = path.resolve(__dirname, '../config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Config] Gagal membaca config.json, menggunakan konfigurasi default:', err.message);
    return {
      max_allowed_per_day: 3,
      base_timeout_minutes: 15,
      increment_timeout_minutes: 15,
      sliding_window_hours: 24,
      delete_violating_message: true,
      exempt_admins: true,
      exempt_roles: [],
      stealth_mode: true,
      notify_violator_via_dm: true,
      notify_owner_via_dm: true
    };
  }
}

/**
 * Menghitung durasi timeout (dalam milidetik) berdasarkan berapa kali timeout sudah pernah dikenakan
 * @param {number} timeoutCount
 * @param {any} config
 * @returns {{ minutes: number, ms: number }}
 */
export function calculateTimeoutDuration(timeoutCount, config) {
  const baseMinutes = config.base_timeout_minutes || 15;
  const incrementMinutes = config.increment_timeout_minutes || 15;

  let durationMinutes = baseMinutes + (timeoutCount * incrementMinutes);

  // Discord membatasi maksimal timeout adalah 28 hari (40.320 menit)
  const MAX_DISCORD_TIMEOUT_MINUTES = 28 * 24 * 60;
  if (durationMinutes > MAX_DISCORD_TIMEOUT_MINUTES) {
    durationMinutes = MAX_DISCORD_TIMEOUT_MINUTES;
  }

  return {
    minutes: durationMinutes,
    ms: durationMinutes * 60 * 1000
  };
}

/**
 * Mengecek apakah member kebal terhadap sanksi satpam
 * @param {import('discord.js').GuildMember} member
 * @param {any} config
 * @returns {boolean}
 */
export function isMemberExempt(member, config) {
  if (!member || member.user.bot) return true;

  // Cek apakah member adalah pemilik server
  if (member.guild.ownerId === member.id) return true;

  // Cek jika administrator diabaikan
  if (config.exempt_admins) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return true;
    }
  }

  // Cek role yang ada dalam daftar whitelist
  if (Array.isArray(config.exempt_roles) && config.exempt_roles.length > 0) {
    const hasExemptRole = member.roles.cache.some(role => config.exempt_roles.includes(role.id));
    if (hasExemptRole) return true;
  }

  return false;
}

/**
 * Memeriksa apakah pesan berisi mention @everyone atau @here
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
export function containsEveryoneMention(message) {
  if (message.mentions.everyone) return true;

  const rawContent = message.content.toLowerCase();
  return rawContent.includes('@everyone') || rawContent.includes('@here');
}

/**
 * Mengirim notifikasi privat ke member pelanggar.
 * Jika DM ditutup, fallback pesan sementara di channel yang auto-delete setelah 7 detik.
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').TextChannel} channel
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {string} fallbackNotice
 */
export async function notifyMemberPrivately(member, channel, embed, fallbackNotice) {
  try {
    await member.send({ embeds: [embed] });
    return true;
  } catch {
    // Jika DM pengguna ditutup, kirim notifikasi singkat di channel lalu hapus dalam 7 detik
    const tempMsg = await channel.send({
      content: `⚠️ <@${member.id}> ${fallbackNotice} *(Pesan otomatis dihapus dalam 7 detik)*`
    }).catch(() => null);

    if (tempMsg) {
      setTimeout(() => tempMsg.delete().catch(() => {}), 7000);
    }
    return false;
  }
}

/**
 * Mengirim laporan otomatis langsung ke DM Pemilik Bot / Owner Server (Terima Beres)
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {import('discord.js').ActionRowBuilder[]} [components]
 */
export async function sendReportToOwner(client, guild, embed, components = []) {
  try {
    if (!client.application?.owner) {
      await client.application?.fetch();
    }
    const appOwner = client.application?.owner;
    let targetOwnerId = null;

    if (appOwner) {
      targetOwnerId = appOwner.id || appOwner.ownerId;
    }

    if (!targetOwnerId && guild?.ownerId) {
      targetOwnerId = guild.ownerId;
    }

    if (targetOwnerId) {
      const ownerUser = await client.users.fetch(targetOwnerId).catch(() => null);
      if (ownerUser) {
        const payload = { embeds: [embed] };
        if (components && components.length > 0) {
          payload.components = components;
        }
        await ownerUser.send(payload).catch(() => null);
      }
    }
  } catch (err) {
    console.warn('[Satpam] Gagal mengirim laporan DM ke owner:', err.message);
  }
}

/**
 * Memproses pesan dan menerapkan sanksi jika melanggar
 * @param {import('discord.js').Message} message
 */
export async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;

  if (!containsEveryoneMention(message)) return;

  const config = loadConfig();
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  // Cek apakah user kebal (Admin / Owner / Whitelist)
  if (isMemberExempt(member, config)) {
    console.log(`[Satpam] Mention @everyone oleh ${member.user.tag} diabaikan (User kebal/Admin).`);
    return;
  }

  const windowHours = config.sliding_window_hours || 24;
  const maxFree = config.max_allowed_per_day || 3;

  // Catat penggunaan tag
  const { record, countToday } = recordMention(message.guild.id, member.id, windowHours);
  const remainingFree = Math.max(0, maxFree - countToday);

  console.log(`[Satpam] @everyone terdeteksi dari ${member.user.tag} (Penggunaan ke-${countToday} dari kuota ${maxFree} hari ini).`);

  // KASUS 1: Masih dalam kesempatan bebas (Tag ke-1 dan ke-2)
  // Orang bebas memakai kuota 3x tanpa diganggu bot
  if (countToday < maxFree) {
    console.log(`[Satpam] ${member.user.tag} masih memiliki sisa kesempatan bebas (${remainingFree}x lagi). Tidak ada tindakan.`);
    return;
  }

  // KASUS 2: Penggunaan ke-3 (Kesempatan 3x Habis -> Peringatan Tegas)
  if (countToday === maxFree) {
    console.log(`[Satpam] ${member.user.tag} telah menggunakan kuota 3x. Mengirimkan peringatan keras ke DM.`);
    const embedWarning = new EmbedBuilder()
      .setColor(0xFFA500) // Oranye peringatan
      .setTitle('⚠️ Peringatan Satpam: Kuota @everyone Telah Habis!')
      .setDescription(
        `Halo <@${member.id}>, kamu sudah menggunakan kesempatan tag \`@everyone\` sebanyak **${countToday}x** hari ini di server **${message.guild.name}**.\n\n` +
        `📊 **Status Kesempatan Kamu:**\n` +
        `• Kesempatan terpakai: **${countToday} / ${maxFree} kali**\n` +
        `• Sisa kesempatan bebas: **0 (HABIS)**\n\n` +
        `🚨 **PERINGATAN KERAS:**\n` +
        `Jika kamu mengirim atau spam tag \`@everyone\` **sekali lagi** hari ini, kamu akan **LANGSUNG DIKENAKAN TIMEOUT SELAMA ${config.base_timeout_minutes} MENIT**!`
      )
      .setFooter({ text: `Server: ${message.guild.name} • Kuota dihitung dalam rentang 24 jam` })
      .setTimestamp();

    if (config.notify_violator_via_dm) {
      await notifyMemberPrivately(
        member,
        message.channel,
        embedWarning,
        `kuota tag @everyone kamu hari ini sudah HABIS (3/3). 1 kali lagi akan langsung kena Timeout! Cek DM kamu.`
      );
    } else {
      await message.channel.send({ embeds: [embedWarning] }).catch(() => null);
    }
    return;
  }

  // KASUS 3: Penggunaan ke-4 dst (> 3x -> Pelanggaran & Kena Timeout!)
  // Hapus pesan spam pelanggar agar obrolan server tetap bersih
  if (config.delete_violating_message && message.deletable) {
    message.delete().catch(err => console.warn('[Satpam] Gagal menghapus pesan spam:', err.message));
  }

  const timeoutCountBefore = record.timeoutCount || 0;
  const { minutes: durationMinutes, ms: durationMs } = calculateTimeoutDuration(timeoutCountBefore, config);

  // Periksa apakah bot memiliki izin moderasi terhadap member ini
  if (!member.moderatable) {
    console.warn(`[Satpam] Tidak dapat memberikan timeout kepada ${member.user.tag} (Role member lebih tinggi atau setara dengan role bot).`);
    return;
  }

  // Terapkan Timeout
  try {
    const reason = `[Satpam Bot] Melebihi batas kuota tag @everyone (${countToday}x dalam 24 jam). Timeout ke-${timeoutCountBefore + 1}.`;
    await member.timeout(durationMs, reason);

    // Update data bahwa timeout berhasil
    recordTimeoutApplied(message.guild.id, member.id, durationMs, windowHours);

    const isFirstTimeout = timeoutCountBefore === 0;
    const embedTimeout = new EmbedBuilder()
      .setColor(0xED4245) // Merah
      .setTitle(isFirstTimeout ? '🚨 Sanksi Satpam: Kamu Dikenakan Timeout!' : '🚨 Sanksi Satpam: Durasi Timeout Ditingkatkan!')
      .setDescription(
        `Kamu telah dijatuhi sanksi **Timeout** di server **${message.guild.name}** karena kembali menggunakan tag \`@everyone\` setelah kuota habis (Pelanggaran ke-${countToday} hari ini).\n\n` +
        `⏱️ **Durasi Timeout:** **${durationMinutes} Menit**\n` +
        `🔢 **Sanksi Pelanggaran ke-:** ${timeoutCountBefore + 1}\n` +
        `📜 **Alasan:** Melanggar batas kuota ${maxFree}x tag @everyone per hari.\n\n` +
        `*Catatan: Jika kamu kembali melakukan tag @everyone di hari yang sama setelah timeout berakhir, durasi timeout berikutnya akan bertambah +${config.increment_timeout_minutes} menit secara progresif.*`
      )
      .setFooter({ text: `Server: ${message.guild.name} • Satpam Otomatis` })
      .setTimestamp();

    // 1. Notifikasi HANYA ke pelanggar (lewat DM agar orang lain di server tidak melihat)
    if (config.notify_violator_via_dm) {
      await notifyMemberPrivately(
        member,
        message.channel,
        embedTimeout,
        `kamu dijatuhi timeout ${durationMinutes} menit karena melanggar batas kuota @everyone. Cek DM kamu!`
      );
    } else {
      await message.channel.send({ embeds: [embedTimeout] }).catch(() => null);
    }

    // 2. Laporan Otomatis ke DM Owner dengan tombol interaktif buka timeout
    if (config.notify_owner_via_dm) {
      const embedOwnerReport = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('👮 Laporan Satpam: Member Dikenakan Timeout')
        .setDescription(
          `Halo Owner! Bot Satpam baru saja menindak member di server Anda.\n\n` +
          `🏠 **Server:** ${message.guild.name}\n` +
          `👤 **Pelanggar:** ${member.user.tag} (<@${member.id}>)\n` +
          `📊 **Pelanggaran:** Tag \`@everyone\` ke-${countToday} (Batas kuota: ${maxFree}x)\n` +
          `⏱️ **Tindakan:** Timeout selama **${durationMinutes} Menit**\n` +
          `🔢 **Sanksi ke-:** ${timeoutCountBefore + 1}\n\n` +
          `*Ingin membebaskan member ini lebih awal? Cukup klik tombol di bawah:*`
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`untimeout_${message.guild.id}_${member.id}`)
          .setLabel('Buka Timeout & Reset Kuota')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🔓')
      );

      await sendReportToOwner(message.client, message.guild, embedOwnerReport, [actionRow]);
    }

  } catch (err) {
    console.error(`[Satpam] Gagal memberikan timeout kepada ${member.user.tag}:`, err);
  }
}
