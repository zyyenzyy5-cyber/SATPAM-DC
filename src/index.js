import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActivityType,
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes
} from 'discord.js';
import { handleMessage, loadConfig, calculateTimeoutDuration } from './satpam.js';
import { getUserRecord, resetUserRecord } from './storage.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || token === 'your_bot_token_here') {
  console.error('\n❌ [Error] DISCORD_TOKEN belum diatur di file .env!');
  console.error('Silakan isi file .env dengan token bot dari Discord Developer Portal.\n');
}

// Inisialisasi Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Definisi Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('satpam-status')
    .setDescription('Cek status pelanggaran mention @everyone')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('Member yang ingin dicek (kosongkan untuk cek diri sendiri)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('satpam-reset')
    .setDescription('Reset riwayat pelanggaran member (Khusus Moderator/Admin)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('Member yang ingin direset riwayatnya')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('satpam-config')
    .setDescription('Lihat konfigurasi aturan satpam saat ini')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
];

/**
 * Daftarkan slash command ke Discord API secara otomatis menggunakan ID bot
 * @param {string} [appId]
 */
async function registerCommands(appId) {
  // Otomatis gunakan ID bot yang sedang login agar bebas dari salah ketik CLIENT_ID
  const targetId = appId || client.application?.id || client.user?.id || clientId;
  if (!token || !targetId) {
    console.warn('[Slash Commands] Lewati registrasi slash command: Application ID belum tersedia.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log(`[Slash Commands] Mendaftarkan slash commands (Application ID: ${targetId})...`);
    if (guildId) {
      // Registrasi instan untuk guild tertentu jika diatur
      await rest.put(
        Routes.applicationGuildCommands(targetId, guildId),
        { body: commands.map(cmd => cmd.toJSON()) }
      );
      console.log(`[Slash Commands] Berhasil didaftarkan secara lokal di server ID: ${guildId}`);
    } else {
      // Registrasi global
      await rest.put(
        Routes.applicationCommands(targetId),
        { body: commands.map(cmd => cmd.toJSON()) }
      );
      console.log('[Slash Commands] Berhasil didaftarkan secara global.');
    }
  } catch (error) {
    console.warn('[Slash Commands] Registrasi slash commands dilewati/tertunda:', error.message);
    console.warn('👉 Fitur utama Satpam (pencegah spam & auto timeout) TETAP BERJALAN 100% NORMAL.');
  }
}

// Event: Bot siap berjalan
client.once(Events.ClientReady, async (c) => {
  const config = loadConfig();

  console.log(`\n==============================================`);
  console.log(`👮 Bot Satpam Berhasil Online sebagai: ${c.user.tag}`);
  console.log(`🛡️ Server yang dijaga: ${c.guilds.cache.size} server`);
  if (config.stealth_mode) {
    console.log(`🕵️ Mode Senyap (Invisible): AKTIF (Member lain melihat bot OFFLINE)`);
  }
  console.log(`==============================================\n`);

  // Atur status keberadaan bot
  // Jika stealth_mode aktif, bot diset 'invisible' agar member lain mengira bot sedang offline!
  if (config.stealth_mode) {
    c.user.setPresence({
      status: 'invisible'
    });
  } else {
    c.user.setPresence({
      activities: [{ name: 'Memantau @everyone 👮‍♂️', type: ActivityType.Watching }],
      status: 'online'
    });
  }

  // Notifikasi pribadi ke Owner bot bahwa satpam sudah aktif (Owner Terima Beres)
  if (config.notify_owner_via_dm) {
    try {
      await c.application.fetch();
      const ownerId = c.application.owner?.id || c.application.owner?.ownerId;
      if (ownerId) {
        const ownerUser = await c.users.fetch(ownerId).catch(() => null);
        if (ownerUser) {
          const readyEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('👮 Bot Satpam Siap Bertugas!')
            .setDescription(
              `Halo Komandan/Owner! Bot Satpam Anda telah aktif dan siap bekerja.\n\n` +
              `🕵️ **Visibilitas Server:** ${config.stealth_mode ? 'Mode Senyap (Member lain melihat bot **OFFLINE**)' : 'Online'}\n` +
              `🛡️ **Server Terhubung:** ${c.guilds.cache.size} server\n` +
              `📩 **Sistem Sanksi:** Notifikasi peringatan dan timeout dikirim **hanya ke DM pelanggar** (orang lain di channel tidak akan tahu).\n\n` +
              `*Anda cukup terima beres! Jika ada member yang melanggar dan ditindak, laporan lengkap akan otomatis masuk ke DM ini.*`
            )
            .setTimestamp();
          await ownerUser.send({ embeds: [readyEmbed] }).catch(() => null);
          console.log(`[Satpam] Sapaan awal berhasil dikirim ke DM owner (${ownerUser.tag}).`);
        }
      }
    } catch (err) {
      console.warn('[Satpam] Gagal mengirim salam ke owner:', err.message);
    }
  }

  // Registrasi slash command secara otomatis menggunakan Application ID bot
  await registerCommands(c.application?.id || c.user.id);
});

// Event: Menangani setiap pesan yang masuk
client.on(Events.MessageCreate, async (message) => {
  try {
    await handleMessage(message);
  } catch (err) {
    console.error('[MessageCreate] Error penanganan pesan:', err);
  }
});

// Event: Menangani Slash Command Interactions
client.on(Events.InteractionCreate, async (interaction) => {
  // Penanganan Tombol Interaktif (misal tombol "Buka Timeout" di DM Owner)
  if (interaction.isButton()) {
    const { customId } = interaction;
    if (customId.startsWith('untimeout_')) {
      const [, targetGuildId, targetUserId] = customId.split('_');

      const targetGuild = client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null);
      if (!targetGuild) {
        await interaction.reply({ content: '❌ Server tidak ditemukan atau bot sudah tidak berada di server tersebut.', ephemeral: true });
        return;
      }

      const targetMember = await targetGuild.members.fetch(targetUserId).catch(() => null);
      let removedFromDiscord = false;

      if (targetMember && targetMember.isCommunicationDisabled()) {
        try {
          await targetMember.timeout(null, 'Sanksi timeout dibuka lebih awal oleh Owner');
          removedFromDiscord = true;
        } catch (err) {
          console.warn('[Satpam] Gagal membuka timeout di Discord:', err.message);
        }
      }

      // Reset kuota di penyimpanan bot
      resetUserRecord(targetGuildId, targetUserId);

      // Ubah tombol menjadi disabled di DM owner
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('untimeout_done')
          .setLabel('✅ Timeout Telah Dibuka oleh Owner')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await interaction.update({ components: [disabledRow] });
      await interaction.followUp({
        content: `🎉 **Berhasil!** Sanksi timeout untuk <@${targetUserId}> telah **dilepas** dan kuotanya sudah **direset ke 3x kembali**!`
      });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const config = loadConfig();

  // Command: /satpam-status (Ephemeral: hanya pengirim yang bisa lihat)
  if (commandName === 'satpam-status') {
    const targetUser = interaction.options.getUser('target') || interaction.user;
    const windowHours = config.sliding_window_hours || 24;
    const record = getUserRecord(interaction.guildId, targetUser.id, windowHours);
    const countToday = record.history.length;
    const maxAllowed = config.max_allowed_per_day || 3;
    const remaining = Math.max(0, maxAllowed - countToday);
    const nextTimeout = calculateTimeoutDuration(record.timeoutCount, config);

    const isExceeded = countToday > maxAllowed;
    const isWarning = countToday === maxAllowed;

    const embed = new EmbedBuilder()
      .setColor(isExceeded ? 0xED4245 : (isWarning ? 0xFFA500 : 0x57F287))
      .setTitle(`📋 Status Satpam: ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: 'Penggunaan @everyone', value: `**${countToday} / ${maxAllowed} kesempatan**`, inline: true },
        { name: 'Sisa Kesempatan Bebas', value: `**${remaining} kali**`, inline: true },
        { name: 'Status Saat Ini', value: isExceeded ? '🚨 **Melanggar (Kena Timeout)**' : (isWarning ? '⚠️ **Peringatan (Kuota Habis, 1x lagi TO)**' : '✅ **Aman**'), inline: true },
        { name: 'Total Kena Timeout Hari Ini', value: `**${record.timeoutCount} kali**`, inline: true },
        { name: 'Durasi Timeout Selanjutnya', value: `**${nextTimeout.minutes} menit**`, inline: true }
      )
      .setFooter({ text: 'Kesempatan bebas 3x per hari • Notifikasi hanya terlihat oleh Anda' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Command: /satpam-reset (Ephemeral)
  if (commandName === 'satpam-reset') {
    const targetUser = interaction.options.getUser('target');
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    let timeoutRemoved = false;
    if (targetMember && targetMember.isCommunicationDisabled()) {
      try {
        await targetMember.timeout(null, 'Timeout dibuka oleh Owner/Moderator via /satpam-reset');
        timeoutRemoved = true;
      } catch (err) {
        console.warn('[Satpam] Gagal melepas timeout di Discord:', err.message);
      }
    }

    resetUserRecord(interaction.guildId, targetUser.id);

    await interaction.reply({
      content: `✅ Sanksi timeout untuk <@${targetUser.id}> ${timeoutRemoved ? 'telah dilepas di Discord dan ' : ''}kuotanya berhasil direset ke 3x kembali!`,
      ephemeral: true
    });
    return;
  }

  // Command: /satpam-config (Ephemeral)
  if (commandName === 'satpam-config') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⚙️ Konfigurasi Bot Satpam')
      .addFields(
        { name: 'Batas Tag Per Hari', value: `${config.max_allowed_per_day} kali`, inline: true },
        { name: 'Durasi Timeout Awal', value: `${config.base_timeout_minutes} menit`, inline: true },
        { name: 'Penambahan Timeout', value: `+${config.increment_timeout_minutes} menit / pelanggaran`, inline: true },
        { name: 'Mode Senyap (Invisible)', value: config.stealth_mode ? '✅ Aktif (Bot terlihat offline)' : '❌ Tidak', inline: true },
        { name: 'Notifikasi Hanya ke DM Pelanggar', value: config.notify_violator_via_dm ? '✅ Ya' : '❌ Tidak', inline: true },
        { name: 'Laporan Otomatis ke DM Owner', value: config.notify_owner_via_dm ? '✅ Ya (Terima Beres)' : '❌ Tidak', inline: true },
        { name: 'Hapus Pesan Spam?', value: config.delete_violating_message ? '✅ Ya' : '❌ Tidak', inline: true },
        { name: 'Admin Kebal?', value: config.exempt_admins ? '✅ Ya' : '❌ Tidak', inline: true }
      )
      .setFooter({ text: 'Hanya Anda yang melihat konfigurasi ini' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
});

// Event: Menangani sinkronisasi ketika Owner/Admin melepas timeout secara manual lewat klik kanan Discord UI
client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  try {
    // Jika sebelumnya member sedang timeout, lalu sekarang sudah tidak timeout (dilepas lewat UI Discord)
    if (oldMember.isCommunicationDisabled() && !newMember.isCommunicationDisabled()) {
      resetUserRecord(newMember.guild.id, newMember.id);
      console.log(`[Satpam] Timeout untuk ${newMember.user.tag} dilepas secara manual di server ${newMember.guild.name}. Kuota berhasil direset.`);
    }
  } catch (err) {
    console.error('[GuildMemberUpdate] Error sinkronisasi timeout:', err);
  }
});

// Menangani graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Bot] Mematikan bot satpam...');
  client.destroy();
  process.exit(0);
});

// Login bot ke Discord jika token tersedia
if (token && token !== 'your_bot_token_here') {
  client.login(token).catch(err => {
    console.error('❌ [Discord Login Error]:', err.message);
    if (err.message.includes('An invalid token was provided')) {
      console.error('👉 Pastikan DISCORD_TOKEN di file .env sudah diisi dengan token bot yang valid.');
    } else if (err.message.includes('Disallowed intent')) {
      console.error('👉 Pastikan "Message Content Intent" dan "Server Members Intent" sudah diaktifkan di tab "Bot" Discord Developer Portal!');
    }
  });
}
