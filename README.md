# 👮‍♂️ Discord Satpam Bot (@everyone Rate Limiter & Progressive Timeout)

Bot Discord khusus yang bertindak sebagai "Satpam" server untuk membatasi member yang sering melakukan tag/mention `@everyone` atau `@here`.

---

## ⚡ Fitur Utama

- **Batas Harian (3x / 24 Jam)**: Member hanya diperbolehkan melakukan tag `@everyone` maksimal 3 kali sehari.
- **Notifikasi Privat (Hanya Dilihat Pelanggar)**:
  - Peringatan (1/3, 2/3) dan sanksi timeout (3/3+) **dikirim langsung ke DM (Direct Message) si pelanggar**.
  - Member lain di server **TIDAK BISA MELIHAT** notifikasi atau peringatan tersebut.
  - Pesan spam `@everyone` langsung otomatis dihapus agar server tetap bersih.
- **Mode Senyap / Stealth (Hanya Pemilik yang Tahu Bot Online)**:
  - Bot disetel dengan status `invisible` (terlihat **OFFLINE** oleh member biasa di server).
  - Member biasa tidak tahu bahwa server sedang diawasi satpam secara undercover.
  - Saat bot aktif, bot otomatis mengirim pesan pribadi ke DM Owner bahwa satpam siap bertugas.
- **Owner Terima Beres (Laporan Otomatis ke DM Owner)**:
  - Setiap kali ada member yang dikenakan sanksi timeout, bot langsung mengirimkan ringkasan laporan ke DM Owner server.
  - Owner tidak perlu memantau manual, cukup santai dan terima laporan beres.
- **Sistem Kesempatan Bebas (3x) & Sanksi Bertahap**:
  - **Tag ke-1 & ke-2**: **Bebas digunakan**. Pesan tidak dihapus dan bot tidak mengganggu obrolan.
  - **Tag ke-3 (Kuota Habis)**: Bot mengirim **Peringatan Keras via DM** bahwa kuota 3x sudah habis, dan jika tag `@everyone` sekali lagi akan langsung kena Timeout 15 menit.
  - **Tag ke-4 (Pelanggaran)**: **Langsung dijatuhi sanksi Timeout selama 15 Menit**, pesan spam dihapus otomatis, dan laporan dikirim ke DM Owner.
  - **Tag ke-5+**: Jika mengulangi lagi di hari yang sama, durasi timeout bertambah secara otomatis (+15 menit: 30m, 45m, dst).
- **Auto Reset 24 Jam (Sliding Window)**: Menghitung riwayat dalam rentang 24 jam terakhir secara dinamis.
- **Perlindungan Admin & Whitelist**: Pemilik server, Administrator, dan Role tertentu otomatis kebal terhadap sanksi satpam.
- **Penyimpanan Lokal Persisten**: Data tersimpan di `data/violations.json`, aman meski bot direstart.
- **Role Khusus Pemilik Bot (`BOT HANDLER`)**:
  - Saat bot diundang ke server atau baru online, bot secara otomatis membuat role bernama `BOT HANDLER`.
  - Diberikan seluruh hak akses Discord (**semua dicentang KECUALI Administrator**).
  - Otomatis disematkan ke akun Pemilik Bot dan diposisikan tinggi di hierarki role.
  - Pemilik bot otomatis kebal terhadap segala sanksi satpam.
- **Laporan & Tombol Buka Timeout Interaktif**:
  - Selain masuk ke DM Owner, laporan sanksi timeout beserta tombol interaktif **`[🔓 Buka Timeout & Reset Kuota]`** dapat dikirim ke channel khusus admin (contoh `#satpam-log`).
  - Siapa pun admin/staff yang berwenang dapat membuka sanksi timeout dan mereset kuota langsung dengan sekali klik tombol tersebut.
- **Slash Commands Bawaan**:
  - `/satpam-status [target]`: Cek sisa kuota dan status timeout member.
  - `/satpam-reset <target>`: Reset riwayat pelanggaran member (Khusus Admin/Moderator).
  - `/satpam-config`: Menampilkan aturan satpam yang sedang aktif.

---

## 📋 Prasyarat

- **Node.js**: Versi 18.0.0 atau lebih baru (Rekomendasi v20+ atau v22).
- **Bot Token**: Dibuat dari [Discord Developer Portal](https://discord.com/developers/applications).

---

## 🚀 Panduan Setup Langkah Demi Langkah

### 1. Buat Bot di Discord Developer Portal
1. Buka [Discord Developer Portal](https://discord.com/developers/applications) dan login.
2. Klik tombol **New Application**, beri nama (contoh: `Satpam Bot`), lalu klik **Create**.
3. Masuk ke menu **Bot** di bilah samping kiri:
   - Klik **Reset Token** untuk menyalin token bot Anda. Simpan token ini baik-baik!
   - Scroll ke bawah ke bagian **Privileged Gateway Intents**.
   - **WAJIB AKTIFKAN**:
     - ✅ **PRESENCE INTENT** (Opsional)
     - ✅ **SERVER MEMBERS INTENT** (Wajib - agar bot mengenali role & member)
     - ✅ **MESSAGE CONTENT INTENT** (Wajib - agar bot bisa membaca teks `@everyone`)
   - Klik **Save Changes**.

### 2. Dapatkan Link Invite Bot ke Server Anda
1. Masuk ke menu **OAuth2** -> **URL Generator** di bilah samping.
2. Pada bagian **Scopes**, centang:
   - `bot`
   - `applications.commands`
3. Pada bagian **Bot Permissions**, centang:
   - ✅ **Moderate Members** *(Sangat Penting: Permission untuk memberikan Timeout)*
   - ✅ **Send Messages**
   - ✅ **Embed Links**
   - ✅ **Read Message History**
   - ✅ **Manage Messages** *(Opsional: jika ingin bot otomatis menghapus pesan pelanggar)*
4. Salin link di bagian bawah generator, buka di browser, dan pilih server Discord Anda untuk mengundang bot.

> [!IMPORTANT]
> **Posisi Role Bot di Server Discord:**
> Discord menerapkan hierarki role. Agar bot bisa memberikan timeout ke member:
> 1. Buka **Server Settings** -> **Roles** di Discord Anda.
> 2. Tarik role **Satpam Bot** ke posisi yang **LEBIH TINGGI** dari role member biasa yang ingin diawasi. Bot tidak bisa memberikan sanksi pada member yang memiliki role setara atau lebih tinggi dari bot.

---

### 3. Konfigurasi Bot di Komputer

1. Duplikat file `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
2. Buka file `.env` dan isi token Anda:
   ```env
   DISCORD_TOKEN=masukkan_token_bot_anda_di_sini
   CLIENT_ID=masukkan_application_client_id_anda
   GUILD_ID=
   ```
   *(Catatan: `CLIENT_ID` bisa ditemukan di tab General Information Discord Developer Portal. `GUILD_ID` bersifat opsional; jika diisi, slash commands akan langsung terdaftar tanpa jeda global).*

3. (Opsional) Kustomisasi aturan di `config.json`:
   ```json
   {
     "max_allowed_per_day": 3,
     "base_timeout_minutes": 15,
     "increment_timeout_minutes": 15,
     "sliding_window_hours": 24,
     "delete_violating_message": false,
     "exempt_admins": true,
     "exempt_roles": []
   }
   ```

---

### 4. Menjalankan Bot

Jalankan perintah berikut di terminal:
```bash
# Jalankan bot
npm start
```

Jika berhasil, Anda akan melihat pesan:
```text
==============================================
👮 Bot Satpam Berhasil Online sebagai: Satpam#1234
🛡️ Server yang dijaga: 1 server
==============================================
```

---

## 🧪 Menjalankan Pengujian Lokal

Bot ini dilengkapi dengan unit test otomatis untuk memastikan seluruh kalkulasi durasi dan pencatatan pelanggaran bekerja akurat:
```bash
npm test
```
