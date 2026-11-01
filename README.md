# Worklog Bot

Bot Discord untuk mencatat jam kerja. `/check-in` memulai stopwatch, `/check-out` menutupnya dengan **link hasil kerja dan deskripsi activity yang wajib diisi**.

## Fitur

| Command | Fungsi |
|---|---|
| `/check-in` | Mulai sesi kerja. Ditolak kalau masih ada sesi aktif. |
| `/check-out link:<url> activity:<teks>` | Tutup sesi. Link harus `http(s)://`, activity minimal 5 karakter. Hasilnya dikirim sebagai embed ke channel log. |
| `/status` | Lihat durasi sesi yang sedang berjalan (hanya terlihat oleh kamu). |
| `/report [hari]` | Rekap jumlah sesi dan total jam, default 7 hari terakhir. |

## Tech Stack

- Node.js 20
- [discord.js](https://discord.js.org) v14
- SQLite via better-sqlite3
- Docker / Docker Compose

## Struktur

```
worklog-bot/
├── index.js            # Bot, slash commands, dan database
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── data/               # File SQLite (dibuat otomatis)
```

## Setup Bot di Discord

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), klik **New Application**.
2. Tab **Bot**: klik **Reset Token**, simpan sebagai `DISCORD_TOKEN`.
3. Tab **General Information**: copy **Application ID** sebagai `CLIENT_ID`.
4. Tab **OAuth2 → URL Generator**:
   - Scope: `bot`, `applications.commands`
   - Permission: `Send Messages`, `Embed Links`
   - Buka URL yang dihasilkan untuk invite bot ke server.
5. Aktifkan **Developer Mode** di Discord (Settings → Advanced), lalu:
   - Klik kanan server → **Copy Server ID** → `GUILD_ID`
   - Klik kanan channel log → **Copy Channel ID** → `LOG_CHANNEL_ID`

## Environment Variables

Salin `.env.example` menjadi `.env`:

| Variable | Wajib | Keterangan |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Token bot |
| `CLIENT_ID` | ✅ | Application ID |
| `GUILD_ID` | ✅ | ID server tempat command didaftarkan |
| `LOG_CHANNEL_ID` | ➖ | Channel tujuan log check-out |
| `DB_PATH` | ➖ | Lokasi file SQLite (default `./data/worklog.db`) |
| `TZ_DISPLAY` | ➖ | Zona waktu tampilan (default `Asia/Jakarta`) |

## Menjalankan Lokal

```bash
cp .env.example .env   # isi nilainya
npm install
npm start
```

Kalau berhasil, log akan menampilkan `✅ Slash commands registered`.

## Deploy

Bot hanya membuka koneksi keluar ke Discord Gateway, jadi **tidak perlu port, domain, atau tunnel**.

### Docker Compose

```bash
docker compose up -d --build
docker compose logs -f
```

### Dokploy

1. Push repo ke GitHub (pastikan `.env` ada di `.gitignore`).
2. Buat service **Compose** yang mengarah ke repo ini.
3. Isi environment variables di tab **Environment**.
4. Klik **Deploy**.

## Data & Backup

Semua sesi tersimpan di tabel `sessions` pada SQLite, di dalam volume `worklog-data`. Data tetap aman saat redeploy.

Backup:

```bash
docker compose cp worklog-bot:/app/data/worklog.db ./backup-worklog.db
```

## Roadmap

- [ ] Reminder otomatis kalau lupa check-out lebih dari 10 jam
- [ ] Export rekap ke CSV
- [ ] Rekap tim per minggu untuk admin
