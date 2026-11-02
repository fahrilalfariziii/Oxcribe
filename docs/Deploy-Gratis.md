# Oxcribe - Panduan Deploy Gratis (Backend di Deno Deploy + Frontend di Vercel)

Panduan ini membawa Oxcribe ke internet **100% gratis**: tanpa trial, tanpa kartu kredit.
Prinsipnya:

- **Backend** (REST API + SSE + Webhook DOKU) di-host di **Deno Deploy** (plan Free, $0 selamanya).
- **Database** Postgres di-host di **Neon** (plan Free, permanen, bukan trial).
- **Frontend** (web-app, landing-page, platform admin) di-host di **Vercel** (plan Hobby), masing-masing 1 project.
- Backend dan frontend berada di domain berbeda (`*.deno.dev` vs `*.vercel.app`), sehingga
  panduan ini juga memuat penyesuaian di kode agar **cookie otentikasi cross-site tetap bekerja**.
  Penyesuaian itu sudah diterapkan di branch ini, detailnya di §1.2 dan §5.2.

> Batas kuota di bawah diverifikasi dari halaman resmi masing-masing platform
> per 2 November 2026 (tautan di §9). Kuota platform bisa berubah, cek ulang tautan itu
> sebelum mulai. Semua nilai yang tidak bisa diverifikasi sengaja tidak ditulis.

## 0. Ringkasan pilihan platform

| Komponen     | Platform    | Plan  | Alasan dipilih                                                                                                        |
| ------------ | ----------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| Postgres     | Neon        | Free  | "Permanent, not a trial, no credit card" (kata resmi halaman pricing Neon). Data tidak dihapus saat kuota habis.          |
| API backend  | Deno Deploy | Free  | Plan gratis $0 selamanya, 1 juta request/bulan, HTTPS otomatis, deploy dari GitHub, tanpa kartu kredit.                    |
| 3 frontend   | Vercel      | Hobby | Gratis untuk penggunaan personal, integrasi monorepo mudah (Root Directory).                                               |

Kenapa **bukan** beberapa alternatif lain (hasil pengecekan langsung ke harganya):

- **Render**: konfigurasi web service menuntut kartu kredit di tahap setup, jadi gugur dari
  syarat "tanpa kartu" yang kita pegang. Render Postgres Free juga kedaluwarsa 30 hari.
- **Koyeb**: tier gratisnya sudah tidak ada; pricing mereka sekarang mulai dari Pro $29/bulan.
- **Zeabur**: tidak ada compute gratis di plan manapun.
- **Sliplane**: tidak ada free tier; hanya demo server 48 jam.
- **Railway / Fly.io / Heroku**: perlu kartu kredit atau hanya trial berbatas waktu.
- **Hugging Face Spaces (Docker)**: butuh plan PRO untuk Space berbasis Docker, plus jaringannya
  dibatasi ke port 80/443/8080 sehingga integrasinya sempit.
- **Cloudflare Workers**: limit CPU 10 ms per request di plan gratis terlalu ketat untuk
  bcrypt hashing, dan butuh tulis ulang besar (Hono + refactor realtime).
- **Serv00**: FreeBSD tidak punya binary engine Prisma.

> **Catatan jangka panjang**: Deno (perusahaan pengelola Deno Deploy) telah mengumumkan
> bergabung dengan Cloudflare. Plan gratis masih berjalan normal saat panduan ini ditulis,
> arah harganya ke depan belum bisa dipastikan. Sebelum menaruh produksi nyata, cek ulang
> halaman pricing di §9.

## 1. Prasyarat

### 1.1 Repo GitHub

1. Seluruh kode Oxcribe sudah ada di **repositori GitHub**. Kalau belum:

   ```bash
   git remote add origin https://github.com/<username>/oxcribe.git
   git push -u origin main
   ```

   Deno Deploy dan Vercel keduanya deploy dari GitHub, jadi repo publik atau private sama saja.

2. Perubahan backend untuk Deno Deploy berada di branch `fitur-deno-deploy`. Cara paling
   sederhana agar semua platform mengambil state yang sama: merge branch itu ke `main`
   lewat Pull Request, lalu push. Deno Deploy dan Vercel cukup mengikuti `main`.

### 1.2 Perubahan kode yang sudah ikut di branch ini

Perubahan tersebut sudah di-commit, Anda tidak perlu mengulangnya, tapi penting untuk tahu:

1. **Prisma 5.20 naik ke 6.19.3 (rust-free) + driver adapter `@prisma/adapter-pg`** di
   `backend/package.json`. Lapisan query engine Rust Prisma lama berformat binary platform
   spesifik dan tidak jalan di Deno Deploy; generator `prisma-client-js` versi 6 dengan
   `previewFeatures = ["driverAdapters", "queryCompiler"]` di `backend/prisma/schema.prisma`
   memakai engine TypeScript yang murni JS, jadi berjalan di runtime Deno
   (`backend/src/lib/prisma.ts` kini memakai `new PrismaPg({ connectionString })`).
2. **Runtime backend di Deno Deploy memakai hasil build tsc (`dist/index.js`, CommonJS)**
   lewat `deno run -A dist/index.js` (task `start` di `backend/deno.json`). Jalankan source
   TS langsung via Deno tidak dipakai karena interop named export `@prisma/client` milik
   CommonJS tidak didukung (`PrismaClient` gagal di-import), sedangkan build tsc-nya jalan mulus.
   Perhatikan `backend/deno.json` sengaja TIDAK berisi `nodeModulesDir`: properti itu hanya
   boleh di `deno.json` workspace root.
3. **Config deploy ada di `deno.json` repo root**, karena build GitHub Deno Deploy saat ini
   belum mendukung aplikasi dari subdirektori (mono-repo belum didukung, kata dok resmi).
   Isinya: install `npm install --include=dev`, build `npm run build --workspace=servopay-backend`,
   entrypoint dinamis `backend/dist/index.js`. Copy nilai yang sama ke wizard bila diminta.
4. **Cookie otentikasi lintas-domain**: `sameSite` memakai `"none"` ketika `NODE_ENV=production`
   (semula selalu `"strict"`) di tiga titik: login tenant `backend/src/routes/auth.routes.ts`,
   refresh token tenant (`POST /api/auth/refresh` di file yang sama), dan login platform admin
   `backend/src/routes/platform.routes.ts`. Detail kenapa di §5.2.
5. **`directUrl` di `backend/prisma/schema.prisma`** menunjuk env `DIRECT_URL`, dipakai CLI
   (`prisma migrate deploy`, `prisma studio`) agar tidak lewat pgbouncer Neon. Client runtime
   tetap memakai `DATABASE_URL` yang pooled; env `DIRECT_URL` di `.env.example` sudah didokumentasikan.
6. **`backend/package-lock.json` dihapus**; `package-lock.json` di repo root sekarang satu-satunya
   lockfile workspace (struktur npm workspaces: `backend` dan `apps/*`). Root `package.json` juga
   menambah `allowScripts` untuk `@prisma/engines`, `prisma`, dan `@prisma/client` agar postinstall
   mereka diperbolehkan oleh npm terbaru.

Verifikasi lokal yang sudah lulus di branch ini: `npm run build` sukses, `deno run -A
dist/index.js` hidup, `GET /health` ok, `GET /api/public/plans` menarik data nyata lewat
Prisma + adapter pg **di runtime Deno**, dan `npx prisma migrate deploy` lulus dengan schema ini.

### 1.3 Nilai rahasia yang disiapkan

Tidak perlu membeli domain. Kita memakai subdomain bawaan:

- Frontend web-app: `https://<nama>.vercel.app`
- Frontend landing: `https://<nama>.vercel.app`
- Frontend admin: `https://<nama>.vercel.app`
- Backend: `https://<nama>.deno.dev`

Siapkan **2 nilai rahasia** yang akan dipakai di backend:

- `JWT_SECRET`: buat string acak panjang, misal via terminal:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- Kredensial DOKU (sandbox dulu): ambil dari https://dashboard.doku.com > Integration > API Keys.

## 2. (A) Database: buat Postgres di Neon

1. Buka https://neon.com/signup, daftar via Google atau GitHub. **Tanpa kartu kredit.**
2. Klik **Create project**:
   - Project name: `oxcribe-prod`
   - Postgres version: biarkan default (16 ke atas).
   - Region: pilih **Singapore** (terdekat untuk Indonesia).
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

## 3. (B) Backend: aplikasi di Deno Deploy

### 3.1 Buat aplikasi dari GitHub

1. Buka https://console.deno.com dan daftar masuk dengan akun GitHub. **Tanpa kartu kredit.**
2. Buat aplikasi baru, sumbernya **GitHub**, pilih organisasi/repo Oxcribe dan branch terpilih
   (setelah merge ke `main`, pakai `main`). Bila repo tidak muncul, izinkan app GitHub
   "Deno Deploy" mengakses repo itu lewat tombol permissions di wizard.
3. Wizard menampilkan **build config** (nilai default sudah diambil dari `deno.json` repo root
   yang dibuat di §1.2 langkah 3; pastikan sama dengan ini):

| Field             | Nilai                                    |
| ----------------- | ----------------------------------------- |
| Framework preset  | No preset                                 |
| Install command   | `npm install --include=dev`               |
| Build command     | `npm run build --workspace=servopay-backend` |
| Runtime           | Dynamic                                   |
| Entrypoint        | `backend/dist/index.js`                   |

Penjelasan jebakan yang ditangani oleh nilai di atas:

- `--include=dev`: CLI `prisma` ada di devDependencies; postinstall workspace `backend`
  (`prisma generate`) dan `tsc` (build) dua-duanya butuh devDependencies.
- `npm install` dijalankan dari repo root sehingga npm menyelesaikan seluruh npm workspaces
  (lockfile tunggal di root) pada satu proses.
- `npm run build` menghasilkan `backend/dist/` yang dipakai entrypoint Deno (`deno run`).
  Port otomatis mengikuti env `PORT` yang disuntik Deno Deploy (lihat `backend/src/index.ts`:
  `Number(process.env.PORT) || 4000`), jadi tidak perlu meng-hardcode apa pun.
- Tipe aplikasi **Dynamic** karena ini API server yang mengeksekusi kode tiap request,
  bukan sekadar file statis.
- Build timeout default 5 menit. Instalasi dependensi Oxcribe biasanya muat; kalau log build
  tewas karena timeout, naikkan nilai Build timeout di drawer tersebut (maksimal lebih besar
  ada di plan berbayar).

4. Nama aplikasi menentukan domainnya: `https://<nama-app>.deno.dev`.

### 3.2 Environment variable backend

Sebelum build pertama sukses dipakai, isi env var di **Settings > Environment Variables**.
Variabel bisa ditandai sebagai secret agar nilainya tidak tampil di dashboard.

| Key                       | Value (contoh/template)                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| `NODE_ENV`                | `production`                                                                  |
| `DATABASE_URL`            | Connection string **pooled** dari Neon (§2 langkah 4)                          |
| `DIRECT_URL`              | Connection string **tanpa** `-pooler` dari Neon (untuk CLI prisma di §3.3)      |
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
| `DOKU_NOTIFICATION_URL`   | `https://<nama-app>.deno.dev/api/public/doku/notification`                      |
| `REDIS_URL`               | kosong (biarkan)                                                               |
| `SMTP_*`                  | kosong (lihat §8 dulu: egress SMTP di Deno Deploy belum terverifikasi)           |

Catatan penting:

- `PORT` sengaja TIDAK diisi: Deno Deploy menyuntik `PORT` sendiri ke runtime (wajib
  dipatuhi oleh aplikasi yang listen HTTP; kode kita sudah patuh).
- `REDIS_URL` sengaja dikosongkan: backend otomatis jalan mode in-process (fan-out SSE dalam
  satu instance). Satu aplikasi Deno Deploy gratisan cukup.
- `CORS_ORIGIN` wajib sudah terisi sebelum boot production. `backend/src/app.ts` secara
  disengaja menolak hidup tanpa `CORS_ORIGIN` saat `NODE_ENV=production` (`CORS_ORIGIN wajib
  di-set di production`). Kalau boot pertama gagal dengan error itu, itu normal karena env var
  belum jadi; isi lalu trigger build/deploy ulang.
- `DOKU_NOTIFICATION_URL` cocokkan dengan nama aplikasi Deno Anda yang sebenarnya;
  inilah URL webhook yang nanti didaftarkan di DOKU (§6).

### 3.3 Migrasi database: dijalankan satu kali dari mesin lokal

Deno Deploy menjalankan kode, bukan CLI Prisma, jadi migrasi paling sederhana dijalankan
dari **mesin lokal Anda** setiap ada perubahan schema (biasanya cuma sekali di awal).
Dari folder `backend`:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@ep-XXXXX-pooler.{region}.aws.neon.tech/neondb?sslmode=require"
$env:DIRECT_URL   = "postgresql://USER:PASSWORD@ep-XXXXX.{region}.aws.neon.tech/neondb?sslmode=require"
npx prisma migrate deploy
```

- `DATABASE_URL` versi pooled cukup untuk CLI dengan bantuan `directUrl` di schema (kini
  menunjuk `DIRECT_URL`, jadi koneksi migrasi tidak lewat pgbouncer).
- Pastikan versi Prisma lokal sudah 6.19.3 (branch ini) supaya hasil generate dan
  migrasi konsisten dengan yang berjalan di Deploy.
- Output yang benar berakhiran "no pending migrations" atau daftar migration ter-apply.

> Alternatif untuk tim yang sudah nyaman CI/CD: jalankan `npx prisma migrate deploy`
> sebagai predeploy dari `deno.json` (key `deploy.predeploy`), dengan syarat env var sudah
> tersedia di fase build platform. Panduan ini tidak mengandalkan itu karena ketersediaan
> env var saat fase build belum terverifikasi stabil.

### 3.4 Deploy pertama dan verifikasi

1. Save env var (§3.2), lalu trigger build (tombol deploy/commit push pertama). Tunggu log
   build: install > prisma generate (postinstall) > tsc > runtime hidup.
2. Buka `https://<nama-app>.deno.dev/health` di browser. Harus menjawab
   `{"status":"ok","service":"oxcribe-backend",...}`.
3. Coba satu endpoint publik yang menyalakan database:
   ```bash
   curl https://<nama-app>.deno.dev/api/public/plans
   ```
   Harus mengembalikan JSON daftar paket. Kalau ini jalan, Prisma + adapter pg + Neon
   sudah tersambung end-to-end di runtime Deno.
4. Skema tabel diurus §3.3; boot runtime tidak membuat tabel sendiri.

### 3.5 Seed data awal (hanya sekali, opsi tersedia)

Seed dijalankan dari mesin lokal ke database Neon (selama satu proses CLI, override env
`DATABASE_URL` ke koneksi production), karena CLI seed berjalan di Node lokal:

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

## 4. (C) Frontend: 3 project di Vercel

Semua tahapnya sama; bedanya hanya Root Directory dan daftar env var. Di semua tabel
di bawah, `VITE_API_BASE_URL` menunjuk domain backend Deno Deploy
(`https://<nama-app>.deno.dev`), bukan domain backend Render.

### 4.1 Akun Vercel

1. Buka https://vercel.com/signup, daftar via GitHub.
2. Pilih **Hobby** (gratis, kartu kredit tidak diminta). Catatan: plan Hobby ditujukan untuk
   penggunaan personal/non-komersial; untuk komersial nanti upgrade ke Pro.

### 4.2 Project web-app (Self-Order + Frontoffice + BackOffice)

1. **Add New** > **Project** > import repo Oxcribe.
2. Di tahap konfigurasi, **Root Directory** = `apps/web-app` (klik "Edit" di sebelah
   Root Directory; folder `apps` akan muncul sebagai opsi). Vercel auto-detect Vite,
   biarkan Build Command dan Output Directory apa adanya (`npm run build` dan `dist`).
   Pointer path build Vercel sudah mendukung subdirektori, beda dari Deno Deploy.
3. Environment Variables:

| Key                    | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`    | `https://<nama-app>.deno.dev` (nama app Deno Deploy Anda yang sebenarnya)           |
| `VITE_PUBLIC_BASE_URL` | URL domain web-app dari Vercel, lihat langkah 6 di bawah                            |

4. Deploy pertama dengan `VITE_PUBLIC_BASE_URL` boleh kosong dulu.
5. Setelah selesai, Vercel memberikan domain, misal `https://oxcribe-web.vercel.app`.
   Catat URL itu, lalu isi `VITE_PUBLIC_BASE_URL` = URL tersebut dan **redeploy**
   (env `VITE_*` dibaca saat build; mengubahnya tanpa rebuild tidak berpengaruh).
   `VITE_PUBLIC_BASE_URL` ini dipakai untuk membangun URL QR meja self-order
   (`<VITE_PUBLIC_BASE_URL>/order/:qrToken`), jadi nilainya harus domain final.

### 4.3 Project landing-page

Import repo yang sama, Root Directory = `apps/landing-page`, env var:

| Key                    | Value                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `VITE_API_BASE_URL`    | `https://<nama-app>.deno.dev`                                             |
| `VITE_WEB_APP_URL`     | URL web-app dari §4.2                                                     |
| `VITE_SALES_WHATSAPP`  | Nomor WhatsApp sales (format internasional tanpa `+`, mis. `6281234567890`) |

### 4.4 Project platform admin

Import repo yang sama, Root Directory = `apps/admin`, env var:

| Key                 | Value                              |
| ------------------- | ------------------------------------ |
| `VITE_API_BASE_URL` | `https://<nama-app>.deno.dev`        |

### 4.5 SPA fallback (wajib untuk refresh di deep-link)

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

## 5. (D) Menyambungkan backend dan frontend (cross-domain)

Frontend dan backend tinggal di domain berbeda, jadi browser menganggap semua request-nya
**cross-site**. Tiga hal berikut membuat instalasi benar-benar tersambung.

### 5.1 CORS: izinkan domain Vercel di backend

Perbarui env `CORS_ORIGIN` di Deno Deploy (Settings > Environment Variables, save memicu
redeploy otomatis):

```
CORS_ORIGIN="https://oxcribe-web.vercel.app,https://oxcribe-landing.vercel.app,https://oxcribe-admin.vercel.app"
```

(dengan URL asli dari §4, tanpa trailing slash, dipisah koma, semua `https://`.)

Sekaligus set:

```
FRONTEND_URL="https://oxcribe-web.vercel.app"
```

`FRONTEND_URL` dipakai mailer untuk membangun link reset password; tanpa ini, link reset pasti
menunjuk `http://localhost:5173`. (Pengiriman email sendiri punya batasannya sendiri di
Deno Deploy, lihat §8.)

### 5.2 Cookie: `SameSite=None` saat production (sudah diterapkan di kode)

Cookie otentikasi semula dibuat dengan `sameSite: "strict"` di tiga titik (login tenant,
refresh tenant, login platform admin). `SameSite=Strict` membuat browser **tidak ikut
mengirim cookie** pada request cross-site, walau `fetch` memakai `credentials: include`.
Dengan domain `*.vercel.app` dan `*.deno.dev` yang berbeda registrable domain, cookie refresh
tidak pernah terkirim dan silent refresh (`POST /api/auth/refresh`) selalu 401, sehingga sesi
user terus dipaksa logout walau request biasa masih tertolong oleh Bearer token di localStorage.

Perbaikannya sudah ada di branch ini (§1.2 langkah 4), pola akhirnya:

```ts
sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
secure: process.env.NODE_ENV === "production",
```

Kombinasi `SameSite=None; Secure` adalah satu-satunya kombinasi yang sah untuk cookie
cross-site, dan aman karena backend sudah melayani HTTPS. Saat `NODE_ENV` bukan production
(dev lokal), tetap Strict seperti semula, tak ada yang berubah di dev. Catatan: pastikan
env `NODE_ENV=production` benar-benar terisi di Deno Deploy (§3.2). Kalau `NODE_ENV` tidak
production, cookie kembali `strict` dan bisu refresh gagal di production.

Perlu dicatat: request **non-refresh** tetap bekerja meski langkah ini terlewat,
karena `apps/web-app/src/lib/api.ts` menyimpan Bearer token di localStorage dan menyalinnya
ke header `Authorization`. Tapi silent refresh butuh cookie, dan tanpa itu pengguna akan
dilempar kembali ke login terlalu sering. Anggap langkah ini wajib, dan itu sudah
diterapkan di branch ini.

### 5.3 Uji koneksi

1. Buka `https://<web-app>.vercel.app/login`, login dengan akun seed
   (`owner@beanbrew.id` / `Owner123!`).
2. Buka DevTools > Network: request harus menuju `https://<nama-app>.deno.dev`, tanpa
   error CORS merah.
3. Buka Frontoffice (`/frontoffice/orders`) di tab, biarkan tayang; koneksi realtime (SSE)
   harus aktif tanpa reconnect berulang.
4. Buka Platform Admin, login `admin@oxcribe.id / Admin123!`.

## 6. (E) DOKU: webhook dan tautkan notifikasi

Dengan backend sudah ber-HTTPS publik, DOKU bisa memanggil webhook kami langsung
(tidak perlu ngrok seperti di dev). Dua endpoint notifikasi yang disediakan backend:

| Fungsi                                         | Method | Path                                          |
| -----------------------------------------------| ------ | ----------------------------------------------- |
| Notifikasi pembayaran (QRIS/VA, recharge juga)  | POST   | `/api/public/doku/notification`                  |
| Notifikasi Sub-Account V2 (setup merchant, dst) | POST   | `/api/public/doku/sub-account/notification`      |

Langkah:

1. Di dashboard DOKU (Sandbox dulu), daftarkan callback/notification URL:
   `https://<nama-app>.deno.dev/api/public/doku/notification`
2. Pastikan env `DOKU_NOTIFICATION_URL` di Deno Deploy serupa dengan URL di dashboard.
3. Uji charge QRIS dari halaman self-order atau kasir; backend menolak webhook yang tidak
   membawa signature + timestamp + secret yang valid (fail-closed), jadi kalau tidak
   ter-update status di UI, cek log Deno Deploy dan pastikan kredensial DOKU benar.
4. Saat beralih ke kredensial production: set `DOKU_IS_PRODUCTION=true`, ganti semua
   `DOKU_*` ke nilai production, dan submit ulang callback URL sesuai tata cara vendor.
5. **Wajib** baca `docs/Operasional-DOKU.md` sebelum menyentuh konfigurasi yang
   menyangkut dana nyata.

## 7. (F) Checklist verifikasi end-to-end

Semua item berikut harus tercentang sebelum menyebut "dideploy":

- [ ] `GET /health` di domain `.deno.dev` menjawab ok.
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
- [ ] Scheduler settlement tidak menampilkan error di log Deno Deploy.
- [ ] Banner `Mode lokal` TIDAK muncul di web-app. Banner itu hanya muncul saat
      server tak terjangkau (fallback lokal, README utama §3), jadi kemunculannya
      berarti backend atau CORS belum benar.

## 8. Batasan plan gratis yang perlu Anda tahu

Semua di bawah adalah batas resmi (bukan perkiraan); cek ulang tautan di §9 jika plan berubah.

**Deno Deploy Free** (detail di halaman pricing mereka):
- $0 selamanya, bukan trial, tanpa kartu kredit. Kuota utamanya di halaman pricing:
  **1.000.000 request per bulan**, **20 GiB egress per bulan**, **10 jam active CPU per bulan**,
  **150 GiB-hours memory per bulan**, 10 aplikasi, 5 custom domain, dan cron tersedia.
- Pantau halaman usage di console bila lalu lintas membesar, dan cek ulang halaman pricing
  untuk mengetahui kebijakan penanganan kuota mereka. Untuk skala toko tunggal di awal: lalu
  lintas POS normal jauh di bawah kuota request dan egress yang ada; yang perlu dipantau adalah
  pihak lain yang tak sengaja memakai API (crawler, pinger ganda, atau loop internal).
- **Instance Dinamis bisa di-unload saat idle.** Tidak ada inbound request atau streaming
  aktif selama sekitar 5 detik sampai 10 menit, sistem mematikan instance (adaptive idle
  timeout), dengan jendela graceful shutdown 5 detik. Boot berikutnya cepat, jauh lebih
  ringan dari spin-up Render lama, tapi ada dua akibat yang perlu diantisipasi:
  (a) request pertama setelah idle diberi jeda boot singkat, dan
  (b) **scheduler in-process** (`node-cron` settlement/payout) hanya hidup selama instance
  hidup; saat idle panjang di malam hari, cron bisa meleset menit-menit.
  Mitigasi: request alami dari toko biasanya menahan instance tetap hidup di jam
  operasional, dan bila konsistensi cron atau zero-cold-start penting bagi Anda, pasang
  pinger gratis (cron-job.org atau UptimeRobot) yang memanggil `GET /health` tiap 10 menit.
- **Egress SMTP belum terverifikasi.** Deno Deploy memakai `fetch`/socket outbound dengan
  aturan jaringannya sendiri; koneksi SMTP keluar (port 465/587 via nodemailer) belum kami
  verifikasi resmi dari dokumen mereka. Dua jalur yang aman:
  (a) kosongkan `SMTP_*` saat awal deploy; link reset tercetak ke log server (mode dev),
  atau (b) pakai layanan email yang menawarkan HTTPS API (email via `fetch`) yang pasti
  jalan dari Deno sebelum mengandalkan SMTP socket.
- Egress ke Postgres Neon: aman, dan memang prinsipnya Deno Deploy mendokumentasikan
  koneksi database eksternal; Neon termasuk salah satu integrasi yang mereka bahas.

**Neon Free**:
- 1 GB storage per project, 100 CU-hours per project per bulan, 5 GB transfer. Melebihi kuota
  hanya menangguhkan compute, tidak menghapus data.
- Compute tidur 5 menit setelah idle dan bangun milidetik saat ada query; aplikasi jenis
  long-lived seperti Oxcribe akan menjaganya selalu hidup selama backend aktif.

**Vercel Hobby**:
- Untuk penggunaan personal; untuk produksi komersial upgrade ke Pro nanti.
- 100 deployment per hari, waktu build maksimal 45 menit, log runtime tersimpan 1 jam.
  Angka ini lebih dari cukup untuk tiga site statis Vite.

**Batas tambahan yang diterapkan Oxcribe sendiri** (bukan platform):
- Jangan run `npm run seed` lebih dari sekali di database production (lihat §3.5).
- Nomor struk `BE-xxxx` bisa berulang antar-seed; yang unik selamanya adalah
  `partnerReferenceNo` per charge ke DOKU (tulisan begini di README utama §5).

## 9. Sumber resmi (diverifikasi 2 November 2026)

- Deno Deploy, pricing & limits free tier: https://deno.com/deploy/pricing
- Deno Deploy, getting started (build config drawer): https://docs.deno.com/deploy/getting_started/
- Deno Deploy, builds (key `deploy` di `deno.json`, mono-repo belum didukung): https://docs.deno.com/deploy/reference/builds/
- Deno Deploy, env vars: https://docs.deno.com/deploy/reference/env_vars_and_contexts/
- Deno Deploy, runtime (idle timeout, graceful shutdown): https://docs.deno.com/deploy/reference/runtime/
- Deno Deploy, databases eksternal (Postgres): https://docs.deno.com/deploy/reference/databases/
- Neon, pricing (Free plan bersifat permanen, tanpa kartu): https://neon.com/pricing
- Vercel, plan & limits: https://vercel.com/docs/limits
- Vercel, environment variables: https://vercel.com/docs/environment-variables
- DOKU Direct API: https://developers.doku.com/accept-payments/direct-api
- Dokumen internal terkait: `README.md` (petunjuk setup dev), `backend/README.md`
  (daftar endpoint, DOKU, backup), `docs/Operasional-DOKU.md` (runbook dana).

## 10. Troubleshooting cepat

| Gejala                                                      | Sebab & isi                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Build Deno Deploy gagal: `prisma: command not found`            | Install command tidak memakai `npm install --include=dev` (devDependencies tidak ikut terinstall)                  |
| Build Deno Deploy tewas karena timeout                          | Install/build terlalu panjang; naikkan Build timeout di build config (§3.1)                                        |
| App tidak hidup: `JWT_SECRET belum di-set`                      | Env `JWT_SECRET` belum diisi di Deno Deploy                                                                        |
| App tidak hidup: `CORS_ORIGIN wajib di-set di production`       | `CORS_ORIGIN` kosong padahal `NODE_ENV=production` (§3.2); ini disengaja oleh `backend/src/app.ts`                  |
| App tidak hidup: `Environment variable not found: DIRECT_URL`  | Bila log memunculkan error ini, isi env `DIRECT_URL` dengan koneksi direct Neon lalu deploy ulang (§3.2)          |
| Migrasi gagal: `Environment variable not found: DIRECT_URL`     | `$env:DIRECT_URL` belum di-set saat menjalankan `npx prisma migrate deploy` dari lokal (§3.3)                       |
| `deno run src/index.ts` gagal: export 'PrismaClient' tidak ada   | Jalur source TS tidak didukung; pakai entrypoint `backend/dist/index.js` hasil `npm run build` (§1.2 langkah 2)     |
| Warning Deno: "nodeModulesDir" hanya boleh di root              | `nodeModulesDir` tidak boleh ada di `backend/deno.json`; biarkan itu hanya pada workspace root                      |
| Frontend menampilkan banner `Mode lokal`                        | `VITE_API_BASE_URL` salah atau CORS menolak; cek §5.1, pastikan domain lengkap `https://`                           |
| Request API merah "blocked by CORS policy"                      | `CORS_ORIGIN` tidak tepat: harus semua URL Vercel dipisah koma, tanpa trailing slash, tanpa `*`                     |
| Login sukses lalu sesi cepat mati                               | `NODE_ENV` tidak ter-set `production` di Deno Deploy, sehingga cookie kembali `strict` (§5.2)                       |
| Refresh halaman dalam (mis. `/order/xxx`) menghasilkan 404      | `vercel.json` rewrites belum ditambahkan di project tersebut (§4.5)                                                 |
| Status pembayaran tidak berubah sesudah bayar                   | `DOKU_NOTIFICATION_URL` beda dengan callback yang terdaftar di DOKU, atau instance sedang idle saat webhook tiba    |
| QR scan memberi "QR meja tidak valid atau tidak aktif"          | Token sudah diregenerate atau meja nonaktif; resolve ulang via Backoffice > Meja (QR itu dinamis)                   |
| Request pertama setelah idle terasa lambat                      | Instance Deno Deploy di-unload saat idle (§8); pinger `GET /health` tiap 10 menit bila perlu                        |
| Cron settlement tidak berjalan tepat waktu                      | Scheduler in-process tidak hidup saat instance idle (§8); jaga instance hidup dengan pinger atau terima drift menit |
