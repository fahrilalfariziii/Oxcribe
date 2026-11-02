# Oxcribe - Panduan Deploy Gratis (Backend + Frontend di Vercel, Database di Neon)

Panduan ini membawa Oxcribe ke internet **100% gratis**: tanpa trial, tanpa kartu kredit.
Prinsipnya:

- **Backend** (REST API + SSE + Webhook DOKU) berjalan sebagai **Vercel Function** (plan Hobby,
  runtime Node.js penuh dengan Fluid compute).
- **Realtime fan-out** SSE memakai **Upstash Redis** pub/sub (free tier), karena di serverless
  event producer dan koneksi SSE bisa mendarat di instance yang berbeda.
- **Cron harian** (settlement + auto-payout) memakai **Vercel Cron Jobs**, gratis di semua plan.
- **Database** Postgres di-host di **Neon** (plan Free, permanen, bukan trial).
- **Frontend** (web-app, landing-page, platform admin) di-host di **Vercel** (plan Hobby),
  masing-masing 1 project. Backend dan frontend jadi satu platform, satu dashboard.
- Backend dan frontend berada di subdomain `*.vercel.app` yang berbeda. Karena `vercel.app`
  terdaftar di Public Suffix List, browser menganggapnya **cross-site**, sehingga panduan ini
  memuat penyesuaian kode agar **cookie otentikasi cross-site tetap bekerja**. Penyesuaian itu
  sudah diterapkan di branch ini, detailnya di §1.2 dan §6.2.

> Batas kuota di bawah diverifikasi dari halaman resmi masing-masing platform
> per 3 November 2026 (tautan di §10). Kuota platform bisa berubah, cek ulang tautan itu
> sebelum mulai. Semua nilai yang tidak bisa diverifikasi sengaja tidak ditulis.

## 0. Ringkasan pilihan platform

| Komponen        | Platform        | Plan  | Alasan dipilih                                                                                                     |
| --------------- | --------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Postgres        | Neon            | Free  | "Permanent, not a trial, no credit card" (kata resmi halaman pricing Neon). Data tidak dihapus saat kuota habis.       |
| API backend     | Vercel Function | Hobby | Runtime Node.js penuh (Express jalan native), cron gratis, region bisa dipilih (Singapore), tanpa kartu kredit.        |
| Realtime pub/sub| Upstash Redis   | Free  | 500K commands/bulan, 250 MB data, 1 database, tanpa kartu kredit (halaman pricing Upstash).                            |
| 3 frontend      | Vercel          | Hobby | Gratis untuk penggunaan personal, integrasi monorepo mudah (Root Directory).                                           |

Kenapa **bukan** beberapa alternatif lain (hasil pengecekan langsung ke harganya):

- **Render**: konfigurasi web service menuntut kartu kredit di tahap setup. Render Postgres
  Free juga kedaluwarsa 30 hari.
- **Koyeb**: tier gratisnya sudah tidak ada; pricing mereka sekarang mulai dari Pro $29/bulan.
- **Zeabur**: tidak ada compute gratis di plan manapun.
- **Sliplane**: tidak ada free tier; hanya demo server 48 jam.
- **Railway / Fly.io / Heroku**: perlu kartu kredit atau hanya trial berbatas waktu.
- **Hugging Face Spaces (Docker)**: butuh plan PRO untuk Space berbasis Docker, plus jaringannya
  dibatasi ke port 80/443/8080 sehingga integrasinya sempit.
- **Cloudflare Workers**: limit CPU 10 ms per request di plan gratis bertabrakan dengan bcrypt
  hashing (puluhan ms CPU), dan fan-out realtime butuh refactor ke Durable Objects.
- **Deno Deploy**: dipakai di iterasi perencanaan sebelumnya, lalu direvisi ke Vercel agar
  backend dan frontend berada di satu platform. Ditambah pertimbangan jangka panjang: Deno
  (perusahaan pengelolanya) mengumumkan bergabung dengan Cloudflare, arah plan gratisnya ke
  depan belum bisa dipastikan.
- **Serv00**: FreeBSD tidak punya binary engine Prisma.

## 1. Prasyarat

### 1.1 Repo GitHub

1. Seluruh kode Oxcribe sudah ada di **repositori GitHub**. Kalau belum:

   ```bash
   git remote add origin https://github.com/<username>/oxcribe.git
   git push -u origin main
   ```

   Vercel deploy dari GitHub, jadi repo publik atau private sama saja.

2. Perubahan backend untuk deploy Vercel berada di branch `fitur-vercel-backend` (diturunkan
   dari `fitur-deno-deploy`). Cara paling sederhana agar semua project mengambil state yang
   sama: merge branch itu ke `main` lewat Pull Request, lalu push. Vercel cukup mengikuti `main`.

### 1.2 Perubahan kode yang sudah ikut di branch ini

Perubahan tersebut sudah di-commit, Anda tidak perlu mengulangnya, tapi penting untuk tahu:

1. **Prisma 5.20 naik ke 6.19.3 (rust-free) + driver adapter `@prisma/adapter-pg`** di
   `backend/package.json`. Diawali untuk target Deno Deploy di iterasi sebelumnya, dan tetap
   dipertahankan di jalur Vercel: engine TypeScript (tanpa binary Rust) membuat cold start
   function lebih ringan dan `backend/src/lib/prisma.ts` kini memakai
   `new PrismaPg({ connectionString })`. Generator `prisma-client-js` dengan
   `previewFeatures = ["driverAdapters", "queryCompiler"]` di `backend/prisma/schema.prisma`.
2. **Entry serverless baru `backend/api/index.ts`**: mengekspor aplikasi Express hasil
   `createApp()` sebagai Vercel Function. `backend/src/index.ts` (server HTTP + scheduler
   in-process) tetap utuh untuk dev lokal dan hosting Node tradisional.
3. **`backend/vercel.json`**: semua request di-rewrite ke `/api/index.ts`, region fungsi
   `sin1` (Singapore, dekat Neon), dan satu cron harian ke `/api/cron` dengan jadwal
   `0 18 * * *` (UTC), setara 01:00 WIB.
4. **Endpoint cron harian `GET /api/cron`** di `backend/src/app.ts`: memverifikasi header
   `Authorization: Bearer <CRON_SECRET>` (fail-closed; tanpa env `CRON_SECRET` selalu 401),
   lalu menjalankan `runDailyJobs()` (settlement + auto-payout) dari `backend/src/lib/scheduler.ts`.
   Di dev lokal, scheduler in-process yang lama tetap jalan seperti biasa.
5. **Realtime SSE siap serverless** (`backend/src/lib/realtime.ts`): ketika `REDIS_URL` terisi,
   id event global memakai Redis `INCR` (konsisten lintas instance) dan replay buffer
   (50 event terakhir per bisnis) disimpan di Redis list, sehingga reconnect dari instance
   mana pun tetap mendapat event yang terlewat. Tanpa `REDIS_URL`, perilaku lama
   (in-process, buffer di memori) tetap dipakai untuk dev lokal.
6. **Cookie otentikasi lintas-domain**: `sameSite` memakai `"none"` ketika `NODE_ENV=production`
   (semula selalu `"strict"`) di tiga titik: login tenant `backend/src/routes/auth.routes.ts`,
   refresh token tenant (`POST /api/auth/refresh` di file yang sama), dan login platform admin
   `backend/src/routes/platform.routes.ts`. Detail kenapa di §6.2.
7. **`directUrl` di `backend/prisma/schema.prisma`** menunjuk env `DIRECT_URL`, dipakai CLI
   (`prisma migrate deploy`, `prisma studio`) agar tidak lewat pgbouncer Neon. Client runtime
   tetap memakai `DATABASE_URL` yang pooled; env `DIRECT_URL` di `.env.example` sudah didokumentasikan.
8. **`backend/package-lock.json` dihapus** (sejak branch sebelumnya); `package-lock.json` di repo
   root sekarang satu-satunya lockfile workspace (npm workspaces: `backend` dan `apps/*`).
   Root `package.json` juga menambah `allowScripts` untuk `@prisma/engines`, `prisma`, dan
   `@prisma/client` agar postinstall mereka diperbolehkan oleh npm terbaru.
9. **Config Deno dihapus** (`deno.json` root dan `backend/deno.json`); target deploy kini Vercel.

Verifikasi lokal yang sudah lulus di branch ini: `npm run build` sukses (termasuk type-check
entry `api/`), server Node hidup, `GET /health` ok dengan build `2026-11-03-vercel`,
`GET /api/public/plans` 200, `GET /api/cron` menolak tanpa secret (401) dan menerima dengan
secret yang benar.

### 1.3 Nilai rahasia yang disiapkan

Tidak perlu membeli domain. Kita memakai subdomain bawaan:

- Backend: `https://<nama-backend>.vercel.app`
- Frontend web-app: `https://<nama>.vercel.app`
- Frontend landing: `https://<nama>.vercel.app`
- Frontend admin: `https://<nama>.vercel.app`

Siapkan **3 nilai rahasia** yang akan dipakai di backend:

- `JWT_SECRET`: buat string acak panjang, misal via terminal:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `CRON_SECRET`: string acak lain (boleh generator yang sama). Vercel Cron otomatis
  menyertakannya sebagai header `Authorization: Bearer <CRON_SECRET>` saat memanggil `/api/cron`.
- Kredensial DOKU (sandbox dulu): ambil dari https://dashboard.doku.com > Integration > API Keys.

## 2. (A) Database: buat Postgres di Neon

1. Buka https://neon.com/signup, daftar via Google atau GitHub. **Tanpa kartu kredit.**
2. Klik **Create project**:
   - Project name: `oxcribe-prod`
   - Postgres version: biarkan default (16 ke atas).
   - Region: pilih **Singapore** (terdekat untuk Indonesia dan sejalan dengan region `sin1`).
3. Setelah project jadi, halaman dashboard menawarkan **Connection string**:
   - Pilih tab/pilihan **Pooled connection** (hostname berisi `-pooler`).
   - Salin string lengkap, formatnya seperti:
     ```
     postgresql://USER:PASSWORD@ep-XXXXX-pooler.{region}.aws.neon.tech/neondb?sslmode=require
     ```
4. Simpan dua versi koneksi untuk langkah backend nanti:
   - `DATABASE_URL` (versi pooled di atas, dipakai runtime aplikasi).
   - `DIRECT_URL` (versi **tanpa** `-pooler`, dipakai `prisma migrate deploy`).
     Cukup hapus `-pooler.` dari hostname: `ep-XXXXX.{region}.aws.neon.tech`.

Kuota plan Free Neon (hanya angka yang tertulis di halaman pricing resmi mereka):
1 GB storage per project, 100 CU-hours per project per bulan, 5 GB network transfer per project,
compute tidur (scale-to-zero) setelah 5 menit idle dan hidup lagi dalam milidetik saat ada query.
Menembus kuota hanya **menangguhkan** compute sampai periode berikutnya, data tidak dihapus.

## 3. (B) Realtime: buat Redis di Upstash

Realtime SSE lintas instance serverless butuh Redis pub/sub, jadi ini bagian dari backend.

1. Buka https://upstash.com, daftar (bisa via GitHub/Google). **Tanpa kartu kredit.**
2. **Create Database**:
   - Name: `oxcribe-realtime`
   - Primary Region: pilih region terdekat untuk Indonesia (contoh: Singapore).
   - Type: Regional.
   - TLS: aktif (default).
3. Setelah jadi, buka database tersebut, cari bagian koneksi, dan salin **Redis Connect
   String** (bukan REST URL). Formatnya seperti:
   ```
   rediss://default:<password>@<host>.upstash.io:6379
   ```
   Inilah nilai `REDIS_URL` untuk langkah §4.2.
4. Kuota free tier Upstash (halaman pricing resmi mereka): **500K commands per bulan**,
   250 MB data, 10 GB bandwidth, 1 database, tanpa kartu kredit. Perkiraan kebutuhan Oxcribe
   skala toko tunggal: setiap event realtime memakai sekitar 5 commands (INCR + 3 operasi
   buffer + PUBLISH), jadi kuota ini cukup untuk ribuan event per hari. Bila toko membesar,
   plan berikutnya mulai dari bayar sesuai pakai $0.20 per 100K commands.

## 4. (C) Backend: Vercel Function di project sendiri

### 4.1 Buat project backend

1. Buka https://vercel.com/signup, daftar via GitHub. Pilih **Hobby** (gratis, kartu kredit
   tidak diminta). Catatan: plan Hobby ditujukan untuk penggunaan personal/non-komersial;
   untuk produksi komersial nanti upgrade ke Pro.
2. **Add New** > **Project** > import repo Oxcribe.
3. Di tahap konfigurasi:
   - **Root Directory** = `backend` (klik "Edit" di sebelah Root Directory).
   - **Framework Preset** = `Other`.
   - **Build Command** dan **Output Directory**: kosongkan (Vercel Function dari folder `api/`
     tidak butuh build terpisah; postinstall `prisma generate` sudah jalan saat install).
4. Sebelum menekan Deploy, isi env var dulu (§4.2), karena `NODE_ENV=production` membuat
   aplikasi menolak hidup tanpa `CORS_ORIGIN` (`backend/src/app.ts` memeriksa itu secara
   disengaja).

### 4.2 Environment variable backend

Isi di **Settings > Environment Variables** project backend (atau di wizard sebelum deploy).

| Key                       | Value (contoh/template)                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| `NODE_ENV`                | `production`                                                                  |
| `DATABASE_URL`            | Connection string **pooled** dari Neon (§2 langkah 4)                          |
| `DIRECT_URL`              | Connection string **tanpa** `-pooler` dari Neon (untuk CLI prisma di §4.3)      |
| `REDIS_URL`               | Connect string `rediss://...` dari Upstash (§3 langkah 3)                      |
| `CRON_SECRET`             | String acak dari §1.3 (Vercel Cron memakainya otomatis sebagai Bearer token)   |
| `JWT_SECRET`              | Hasil generator acak dari §1.3                                                 |
| `JWT_EXPIRES_IN`          | `7d`                                                                          |
| `PLATFORM_JWT_EXPIRES_IN` | `12h`                                                                         |
| `CORS_ORIGIN`             | `https://<web-app>.vercel.app,https://<landing>.vercel.app,https://<admin>.vercel.app` (diisi ulang di §5) |
| `FRONTEND_URL`            | `https://<web-app>.vercel.app` (diisi ulang di §5; dipakai link reset password)  |
| `DOKU_CLIENT_ID`          | dari dashboard DOKU (Sandbox dulu)                                             |
| `DOKU_SECRET_KEY`         | dari dashboard DOKU (Sandbox dulu)                                             |
| `DOKU_PRIVATE_KEY`        | Private key RSA DOKU, baris baru ditulis `\n` (lihat `backend/.env.example`)     |
| `DOKU_MERCHANT_ID`        | dari dashboard DOKU                                                            |
| `DOKU_TERMINAL_ID`        | dari dashboard DOKU                                                            |
| `DOKU_POSTAL_CODE`        | `10110` (atau sesuai merchant)                                                 |
| `DOKU_VA_*`               | Service ID & prefix VA per bank (kosong dulu kalau DOKU belum memberikan, lihat comment di `backend/.env.example`) |
| `DOKU_IS_PRODUCTION`      | `false` (naikkan ke `true` hanya saat kredensial production sudah dipasang)      |
| `DOKU_NOTIFICATION_URL`   | `https://<nama-backend>.vercel.app/api/public/doku/notification`                |
| `SMTP_*`                  | kosong dulu (egress SMTP di Vercel Functions belum terverifikasi, lihat §9)      |

Catatan penting:

- `PORT` sengaja TIDAK diisi: Vercel mengatur port di balik layar; entry
  `backend/api/index.ts` mengekspor app Express tanpa `app.listen`.
- `REDIS_URL` wajib terisi di deploy serverless. Tanpa itu realtime jalan mode in-process,
  dan event pesanan bisa gagal sampai ke koneksi SSE yang mendarat di instance lain.
- `DOKU_NOTIFICATION_URL` cocokkan dengan nama project backend Anda yang sebenarnya;
  inilah URL webhook yang nanti didaftarkan di DOKU (§6).

### 4.3 Migrasi database: dijalankan dari mesin lokal

Vercel Function tidak menjalankan CLI Prisma, jadi migrasi dijalankan dari **mesin lokal
Anda** setiap ada perubahan schema (biasanya cuma sekali di awal). Dari folder `backend`:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@ep-XXXXX-pooler.{region}.aws.neon.tech/neondb?sslmode=require"
$env:DIRECT_URL   = "postgresql://USER:PASSWORD@ep-XXXXX.{region}.aws.neon.tech/neondb?sslmode=require"
npx prisma migrate deploy
```

- `directUrl` di schema menunjuk `DIRECT_URL`, jadi koneksi migrasi tidak lewat pgbouncer.
- Pastikan Prisma lokal sudah 6.19.3 (branch ini) supaya hasil generate dan migrasi konsisten
  dengan yang berjalan di Vercel.
- Output yang benar berakhiran "no pending migrations" atau daftar migration ter-apply.

### 4.4 Deploy pertama dan verifikasi

1. Save env var, lalu trigger deploy (deploy pertama dari wizard, atau commit push berikutnya).
2. Buka `https://<nama-backend>.vercel.app/health` di browser. Harus menjawab
   `{"status":"ok","service":"oxcribe-backend","build":"2026-11-03-vercel",...}`.
3. Coba satu endpoint publik yang menyalakan database:
   ```bash
   curl https://<nama-backend>.vercel.app/api/public/plans
   ```
   Harus mengembalikan JSON daftar paket. Kalau ini jalan, Prisma + adapter pg + Neon
   sudah tersambung end-to-end.
4. Uji endpoint cron (harus 401 tanpa secret):
   ```bash
   curl https://<nama-backend>.vercel.app/api/cron
   ```
5. Uji cron dengan secret (harus `{"ok":true,...}`). Settlement bersifat rekonsiliasi
   (menyelesaikan saldo yang tertunda), jadi aman dipanggil ulang:
   ```bash
   curl https://<nama-backend>.vercel.app/api/cron -H "Authorization: Bearer <CRON_SECRET>"
   ```

### 4.5 Cron harian: cara kerja dan batasannya

- Jadwal ada di `backend/vercel.json` (`"crons"`): `0 18 * * *` (UTC) = 01:00 WIB.
  Ubah jadwal di file itu lalu push; Vercel membaca ulang otomatis.
- **Batas plan Hobby** (dok resmi Vercel): cron hanya bisa berjalan **sekali per hari**, dan
  eksekusinya bisa terjadi **di menit mana pun dalam jam yang ditentukan** (mis. jadwal
  `0 18 * * *` bisa dieksekusi kapan saja antara 18:00:00 sampai 18:59:59 UTC). Untuk
  settlement harian, rentang satu jam ini tidak masalah.
- Cron tidak di-retry bila gagal, dan pengirimannya best effort. Pekerjaannya dirancang
  idempotent (rekonsiliasi saldo), jadi kalau satu hari terlewat, hari berikutnya menyelesaikan
  backlog. Endpoint `/api/cron` juga bisa dipanggil manual dengan secret kapan saja.

### 4.6 Seed data awal (hanya sekali, opsi tersedia)

Seed dijalankan dari mesin lokal ke database Neon (override env `DATABASE_URL` ke koneksi
production selama satu proses CLI):

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@ep-XXXXX-pooler.{region}.aws.neon.tech/neondb?sslmode=require"
npm run seed --workspace=servopay-backend
```

Dua jalur, pilih salah satu:

**Jalur 1 (paling cepat): seed demo lengkap sekali.**
`npm run seed` melakukan `TRUNCATE` semua tabel dan me-restart sequence. Karena database
production ini masih kosong, TRUNCATE tidak menghapus hal berharga apa pun, tapi **JALAN INI
HANYA SEKALI**. Kalau nanti dijalankan lagi di database yang sudah berisi transaksi asli, semua
data hilang. Setelah log seed menunjukkan data tertulis (plans, platform admin, tenant demo
BeanBrew), akun seed ikut terbawa ke production (catatan yang sama ada di README utama §4).
Sebelum aplikasi dibuka ke siapa pun, segera ganti password semua akun seed
(owner/kasir/barista dan admin/support platform) dari dalam aplikasi.

**Jalur 2 (produksi murni): tanpa seed demo.**
Biarkan database kosong; backend tetap jalan normal, tinggal dibuat data awal minimal lewat UI
Platform Admin (register tenant, dst). Perhatikan satu detail penting: fallback feature-gate
saat tenant tanpa `currentPlan` memakai paket statis "pro" di `backend/src/lib/feature-gate.ts`,
jadi fitur tetap terbuka, tapi UI admin membutuhkan baris `Plan` agar paket bisa dikelola.
Kalau memilih jalur ini dan `Plan` belum ada, jalankan alur seed Jalur 1 lalu hapus tenant
demo, atau sisipkan data `Plan` lewat Platform Admin.

## 5. (D) Frontend: 3 project di Vercel

Semua tahapnya sama; bedanya hanya Root Directory dan daftar env var. Di semua tabel
di bawah, `VITE_API_BASE_URL` menunjuk domain backend Vercel dari §4.2
(`https://<nama-backend>.vercel.app`).

### 5.1 Project web-app (Self-Order + Frontoffice + BackOffice)

1. **Add New** > **Project** > import repo Oxcribe.
2. Di tahap konfigurasi, **Root Directory** = `apps/web-app`. Vercel auto-detect Vite,
   biarkan Build Command dan Output Directory apa adanya (`npm run build` dan `dist`).
3. Environment Variables:

| Key                    | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`    | `https://<nama-backend>.vercel.app` (nama project backend Anda yang sebenarnya)     |
| `VITE_PUBLIC_BASE_URL` | URL domain web-app dari Vercel, lihat langkah 6 di bawah                            |

4. Deploy pertama dengan `VITE_PUBLIC_BASE_URL` boleh kosong dulu.
5. Setelah selesai, Vercel memberikan domain, misal `https://oxcribe-web.vercel.app`.
   Catat URL itu, lalu isi `VITE_PUBLIC_BASE_URL` = URL tersebut dan **redeploy**
   (env `VITE_*` dibaca saat build; mengubahnya tanpa rebuild tidak berpengaruh).
   `VITE_PUBLIC_BASE_URL` ini dipakai untuk membangun URL QR meja self-order
   (`<VITE_PUBLIC_BASE_URL>/order/:qrToken`), jadi nilainya harus domain final.

### 5.2 Project landing-page

Import repo yang sama, Root Directory = `apps/landing-page`, env var:

| Key                    | Value                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `VITE_API_BASE_URL`    | `https://<nama-backend>.vercel.app`                                       |
| `VITE_WEB_APP_URL`     | URL web-app dari §5.1                                                     |
| `VITE_SALES_WHATSAPP`  | Nomor WhatsApp sales (format internasional tanpa `+`, mis. `6281234567890`) |

### 5.3 Project platform admin

Import repo yang sama, Root Directory = `apps/admin`, env var:

| Key                 | Value                              |
| ------------------- | ------------------------------------ |
| `VITE_API_BASE_URL` | `https://<nama-backend>.vercel.app`  |

### 5.4 SPA fallback (wajib untuk refresh di deep-link)

Ketiga frontend memakai React Router (`BrowserRouter`), jadi refresh di URL dalam
(mis. `/backoffice/dashboard` atau `/order/<token>`) akan 404 tanpa rewrite. Untuk tiap
project di atas, buat file `vercel.json` di dalam folder masing-masing
(`apps/web-app/vercel.json`, `apps/landing-page/vercel.json`, `apps/admin/vercel.json`)
isinya:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Commit dan push; Vercel akan redeploy otomatis.

## 6. (E) Menyambungkan backend dan frontend (cross-site)

Frontend dan backend berada di subdomain `*.vercel.app` yang berbeda, dan karena `vercel.app`
terdaftar di Public Suffix List, browser menganggapnya **cross-site**. Dua hal berikut membuat
instalasi benar-benar tersambung.

### 6.1 CORS: izinkan domain frontend di backend

Perbarui env `CORS_ORIGIN` di project backend (Settings > Environment Variables; menyimpan
memicu redeploy):

```
CORS_ORIGIN="https://oxcribe-web.vercel.app,https://oxcribe-landing.vercel.app,https://oxcribe-admin.vercel.app"
```

(dengan URL asli dari §5, tanpa trailing slash, dipisah koma, semua `https://`.)

Sekaligus set:

```
FRONTEND_URL="https://oxcribe-web.vercel.app"
```

`FRONTEND_URL` dipakai mailer untuk membangun link reset password; tanpa ini, link reset pasti
menunjuk `http://localhost:5173`. (Pengiriman email sendiri punya batasannya sendiri di
Vercel, lihat §8.)

### 6.2 Cookie: `SameSite=None` saat production (sudah diterapkan di kode)

Cookie otentikasi semula dibuat dengan `sameSite: "strict"` di tiga titik (login tenant,
refresh tenant, login platform admin). `SameSite=Strict` membuat browser **tidak ikut
mengirim cookie** pada request cross-site, walau `fetch` memakai `credentials: include`.
Karena subdomain `*.vercel.app` berbeda registrable domain (Public Suffix List), cookie refresh
tidak pernah terkirim dan silent refresh (`POST /api/auth/refresh`) selalu 401, sehingga sesi
user terus dipaksa logout walau request biasa masih tertolong oleh Bearer token di localStorage.

Perbaikannya sudah ada di branch ini (§1.2 langkah 6), pola akhirnya:

```ts
sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
secure: process.env.NODE_ENV === "production",
```

Kombinasi `SameSite=None; Secure` adalah satu-satunya kombinasi yang sah untuk cookie
cross-site, dan aman karena backend sudah melayani HTTPS. Saat `NODE_ENV` bukan production
(dev lokal), tetap Strict seperti semula, tak ada yang berubah di dev. Catatan: pastikan
env `NODE_ENV=production` benar-benar terisi di Vercel (§4.2). Kalau `NODE_ENV` tidak
production, cookie kembali `strict` dan silent refresh gagal di production.

Perlu dicatat: request **non-refresh** tetap bekerja meski langkah ini terlewat,
karena `apps/web-app/src/lib/api.ts` menyimpan Bearer token di localStorage dan menyalinnya
ke header `Authorization`. Tapi silent refresh butuh cookie, dan tanpa itu pengguna akan
dilempar kembali ke login terlalu sering. Anggap langkah ini wajib, dan itu sudah
diterapkan di branch ini.

### 6.3 Uji koneksi

1. Buka `https://<web-app>.vercel.app/login`, login dengan akun seed
   (`owner@beanbrew.id` / `Owner123!`).
2. Buka DevTools > Network: request harus menuju `https://<nama-backend>.vercel.app`, tanpa
   error CORS merah.
3. Buka Frontoffice (`/frontoffice/orders`) di tab, biarkan tayang; koneksi realtime (SSE)
   harus aktif tanpa reconnect berulang.
4. Buka Platform Admin, login `admin@oxcribe.id / Admin123!`.

## 7. (F) DOKU: webhook dan tautkan notifikasi

Dengan backend sudah ber-HTTPS publik, DOKU bisa memanggil webhook kami langsung
(tidak perlu ngrok seperti di dev). Dua endpoint notifikasi yang disediakan backend:

| Fungsi                                         | Method | Path                                          |
| -----------------------------------------------| ------ | ----------------------------------------------- |
| Notifikasi pembayaran (QRIS/VA, recharge juga)  | POST   | `/api/public/doku/notification`                  |
| Notifikasi Sub-Account V2 (setup merchant, dst) | POST   | `/api/public/doku/sub-account/notification`      |

Langkah:

1. Di dashboard DOKU (Sandbox dulu), daftarkan callback/notification URL:
   `https://<nama-backend>.vercel.app/api/public/doku/notification`
2. Pastikan env `DOKU_NOTIFICATION_URL` di Vercel serupa dengan URL di dashboard.
3. Uji charge QRIS dari halaman self-order atau kasir; backend menolak webhook yang tidak
   membawa signature + timestamp + secret yang valid (fail-closed), jadi kalau tidak
   ter-update status di UI, cek log Vercel dan pastikan kredensial DOKU benar.
4. Saat beralih ke kredensial production: set `DOKU_IS_PRODUCTION=true`, ganti semua
   `DOKU_*` ke nilai production, dan submit ulang callback URL sesuai tata cara vendor.
5. **Wajib** baca `docs/Operasional-DOKU.md` sebelum menyentuh konfigurasi yang
   menyangkut dana nyata.

## 8. (G) Checklist verifikasi end-to-end

Semua item berikut harus tercentang sebelum menyebut "dideploy":

- [ ] `GET /health` di domain backend `.vercel.app` menjawab ok.
- [ ] Frontoffice dan Backoffice web-app dapat login via domain Vercel; tidak ada
      error CORS di console.
- [ ] Silent refresh bekerja: biarkan sesi idle mendekati expire lalu lakukan aksi
      berikutnya; sesi tidak dipaksa logout.
- [ ] UI admin tampil normal setelah login platform admin (`apps/admin`).
- [ ] Buat meja di backoffice, generate QR, scan dari HP: self-order memuat
      katalog (`GET /api/public/tables/:qrToken`).
- [ ] Dengan tab kasir di `/frontoffice/orders` tetap terbuka, buat pesanan via
      self-order lalu pesanan muncul **tanpa reload** (SSE `order:new`).
- [ ] Ubah status pesanan; status terbaru juga muncul di sisi self-order.
- [ ] Pembayaran QRIS memunculkan QR dari DOKU; webhook DOKU mengubah payment
      `pending` menjadi `paid` di UI kedua sisi.
- [ ] `GET /api/cron` dengan Bearer secret menjawab `{"ok":true}` dan cron harian
      tampil di tab Cron Jobs project backend.
- [ ] Banner `Mode lokal` TIDAK muncul di web-app. Banner itu hanya muncul saat
      server tak terjangkau (fallback lokal, README utama §3), jadi kemunculannya
      berarti backend atau CORS belum benar.

## 9. Batasan plan gratis yang perlu Anda tahu

Semua di bawah adalah batas resmi (bukan perkiraan); cek ulang tautan di §10 jika plan berubah.

**Vercel Functions (Hobby, Fluid compute)** (dok resmi Vercel):
- Plan gratis tanpa kartu kredit. Maksimum durasi fungsi: **300 detik** (default dan maksimum
  Hobby). Memory: **2 GB / 1 vCPU**. Ukuran bundle: 250 MB uncompressed. Maksimum request body:
  4.5 MB. CPU hanya dihitung saat aktif; menunggu query database tidak dihitung.
- **Koneksi SSE terputus setiap 300 detik.** Kode SSE kami sudah mengantisipasi:
  client memakai `EventSource` dengan `retry: 5000` dan resume `Last-Event-ID`, dan replay
  buffer disimpan di Redis, jadi reconnect (termasuk dari instance berbeda) tetap mendapat
  event yang terlewat.
- **Cold start**: request pertama setelah idle ada jeda boot singkat (skala detik).
  Frontend punya fallback `Mode lokal`, jadi sesekali cold start hanya terasa sebagai
  jeda, bukan error.
- **Region**: Hobby boleh memilih satu region; kami set `sin1` (Singapore) via
  `backend/vercel.json`, sejajar dengan region Neon.

**Vercel Cron Jobs (Hobby)** (dok resmi Vercel):
- Tersedia di semua plan, gratis. Batas Hobby: **sekali per hari**, dieksekusi di menit
  mana pun **dalam jam** yang ditentukan (mis. `0 18 * * *` bisa dieksekusi 18:00 sampai
  18:59 UTC). Tidak ada retry bila gagal; pengiriman best effort. Durasi eksekusi cron
  sama dengan limit durasi fungsi (300 detik Hobby).
- Mitigasi yang sudah dibangun: pekerjaan harian bersifat rekonsiliasi (settlement menutup
  saldo tertunda, auto-payout dicek ulang tiap eksekusi), dan endpoint `/api/cron` bisa
  dipanggil manual dengan Bearer secret kapan saja sebagai backup.

**Upstash Redis Free** (halaman pricing resmi):
- **500K commands per bulan**, 250 MB data, 10 GB bandwidth, 1 database, tanpa kartu kredit.
- Perkiraan pakai Oxcribe: sekitar 5 commands per event realtime (INCR + 3 operasi buffer
  + PUBLISH), jadi kuota cukup untuk ribuan event per hari. Pantau usage di dashboard
  Upstash bila lalu lintas membesar.

**Neon Free**:
- 1 GB storage per project, 100 CU-hours per project per bulan, 5 GB transfer. Melebihi kuota
  hanya menangguhkan compute, tidak menghapus data.
- Compute tidur 5 menit setelah idle dan bangun milidetik saat ada query.

**Vercel Hobby (ketentuan umum)**:
- Ditujukan untuk penggunaan personal/non-komersial; untuk produksi komersial upgrade ke Pro.
- Cek halaman limits resmi Vercel (tautan §10) untuk angka kuota terbaru di luar yang
  tercantum di sini.

**Lain-lain**:
- **SMTP belum terverifikasi**: Vercel Functions tidak memblokir outbound TCP secara umum,
  tapi pengiriman SMTP dari cloud IP sering bermasalah (deliverability/limit penyedia email).
  Jalur aman: kosongkan `SMTP_*` dulu, link reset password tercetak ke log function (mode dev),
  atau pakai layanan email dengan HTTP API. Uji SMTP langsung bila memang diperlukan.
- Jangan run `npm run seed` lebih dari sekali di database production (lihat §4.6).
- Nomor struk `BE-xxxx` bisa berulang antar-seed; yang unik selamanya adalah
  `partnerReferenceNo` per charge ke DOKU (tulisan begini di README utama §5).

## 10. Sumber resmi (diverifikasi 3 November 2026)

- Vercel, Vercel Functions limits (durasi, memory, bundle, body size): https://vercel.com/docs/functions/limitations
- Vercel, Cron Jobs (batas Hobby sekali per hari, jitter jam, CRON_SECRET): https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel, Function regions (Hobby satu region): https://vercel.com/docs/functions/configuring-functions/region
- Vercel, environment variables: https://vercel.com/docs/environment-variables
- Upstash, pricing Redis (free tier 500K commands/bulan, 250 MB): https://upstash.com/pricing/redis
- Neon, pricing (Free plan bersifat permanen, tanpa kartu): https://neon.com/pricing
- Prisma, database drivers (driver adapters, termasuk `@prisma/adapter-pg`): https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers
- DOKU Direct API: https://developers.doku.com/accept-payments/direct-api
- Dokumen internal terkait: `README.md` (petunjuk setup dev), `backend/README.md`
  (daftar endpoint, DOKU, backup), `docs/Operasional-DOKU.md` (runbook dana).

## 11. Troubleshooting cepat

| Gejala                                                    | Sebab & isi                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Boot gagal: `CORS_ORIGIN wajib di-set di production`          | `CORS_ORIGIN` kosong padahal `NODE_ENV=production` (§4.2); ini disengaja oleh `backend/src/app.ts`    |
| Boot gagal: `JWT_SECRET belum di-set`                         | Env `JWT_SECRET` belum diisi di project backend Vercel                                                |
| Function timeout (504 `FUNCTION_INVOCATION_TIMEOUT`)          | Eksekusi melebihi 300 detik; periksa query lambat atau loop besar di request tersebut                 |
| Event realtime tidak sampai ke beberapa tab                   | `REDIS_URL` kosong/salah sehingga realtime jalan in-process (§4.2); pastikan connect string Upstash   |
| SSE sering reconnect tiap beberapa menit                      | Perilaku normal: durasi fungsi maksimum 300 detik (§9); reconnect diatur `retry: 5000` + replay buffer |
| Event terlewat saat reconnect                                 | `REDIS_URL` wajib terisi; replay buffer disimpan di Redis list (mode in-process hanya untuk dev)       |
| Migrasi gagal: `Environment variable not found: DIRECT_URL`   | `$env:DIRECT_URL` belum di-set saat menjalankan `npx prisma migrate deploy` dari lokal (§4.3)         |
| `GET /api/cron` selalu 401                                    | Env `CRON_SECRET` belum ter-set di Vercel, atau header Bearer tidak cocok; ini fail-closed (§4.2)     |
| Cron tidak jalan                                              | Cek tab Cron Jobs di project backend; jadwal di `backend/vercel.json` harus ter-push; Hobby sekali    |
|                                                              | per hari dan bisa dieksekusi di menit mana pun dalam jam yang ditentukan (§4.5)                        |
| Frontend menampilkan banner `Mode lokal`                      | `VITE_API_BASE_URL` salah atau CORS menolak; cek §6.1, pastikan domain lengkap `https://`             |
| Request API merah "blocked by CORS policy"                    | `CORS_ORIGIN` tidak tepat: harus semua URL frontend dipisah koma, tanpa trailing slash, tanpa `*`     |
| Login sukses lalu sesi cepat mati                             | `NODE_ENV` tidak ter-set `production` di Vercel, sehingga cookie kembali `strict` (§6.2)              |
| Refresh halaman dalam (mis. `/order/xxx`) menghasilkan 404    | `vercel.json` rewrites frontend belum ditambahkan di project tersebut (§5.4)                          |
| Status pembayaran tidak berubah sesudah bayar                 | `DOKU_NOTIFICATION_URL` beda dengan callback yang terdaftar di DOKU (§7)                              |
| QR scan memberi "QR meja tidak valid atau tidak aktif"        | Token sudah diregenerate atau meja nonaktif; resolve ulang via Backoffice > Meja (QR itu dinamis)     |
| Build Vercel gagal soal dependensi workspace                  | Pastikan Root Directory = `backend` dan tidak ada lockfile lain selain root `package-lock.json`        |
|                                                              | (lockfile tunggal di repo root, §1.2 langkah 8)                                                        |
| Link reset password menunjuk localhost                        | `FRONTEND_URL` belum di-set ke domain web-app final (§6.1)                                            |
