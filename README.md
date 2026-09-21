# PROJECT COFFEE SHOP MANAGEMENT (Ordria)

## 1. Overview

Aplikasi ini bertujuan untuk mendigitalkan dan menyederhanakan proses pemesanan coffee shop, mulai dari pelanggan melakukan self-order melalui QR Code di meja, pesanan masuk secara real-time ke kasir/barista, proses pembayaran, hingga pengelolaan menu, meja, stok, dan analitik oleh owner.

Sistem dirancang sebagai **Web App** dengan tiga area utama, yaitu **Halaman Pemesanan Pelanggan (Self-Ordering App)**, **Halaman Frontoffice (Kasir / Barista)**, dan **Halaman BackOffice (Owner — Analytics & Management)**. Fokus utama sistem adalah mempercepat proses pemesanan, mengurangi kesalahan input manual, menyediakan status pesanan secara real-time, dan memberikan owner data penjualan yang mudah dipantau.

Spesifikasi lengkap ada di `docs/prd_POS_updated.md` (skema 12 tabel + kolom tambahan Fase 2, alur Self-Order/Frontoffice/BackOffice, aturan pajak/service, payment, tema).

## 2. Struktur monorepo

```
servopay/
├── docs/                 # PRD + dokumentasi produk
├── backend/              # REST API + Realtime + Midtrans (Node.js/Express/Prisma/Postgres)
│   └── README.md         # setup, akun seed, SEMUA endpoint + contoh curl/Postman, Midtrans, backup
├── apps/
│   ├── web-app/          # Aplikasi Ordria utama: Self-Order, Frontoffice (POS), BackOffice (Owner)
│   ├── landing-page/     # Website marketing publik (paket + form trial) — port 5174
│   └── admin/            # Dashboard Platform Admin internal — port 5175
└── README.md             # file ini
```

> Riwayat: folder `frontend/` dipindah ke `apps/web-app/` via `git mv` (history git dipertahankan).
> `apps/web-app/README.md` adalah README frontend lama (rute per role, aturan bisnis, struktur folder).

## 3. Status integrasi (Fase 2 — FE↔BE tersambung)

- **Backend berdiri sendiri** — semua endpoint bisa dites langsung via curl/Postman tanpa frontend
  (lihat `backend/README.md` §3: health, auth, self-order publik, plans/leads publik, orders, business, staff, tables,
  products, ingredients, analytics, printer, webhook Midtrans).
- **Web-app terintegrasi BE** — halaman kasir & owner memuat/menyimpan via REST + realtime SSE.
  Fallback lokal (seed `apps/web-app/src/mock/data.ts`) hanya dipakai saat server tak terjangkau, dengan
  banner "Mode lokal" yang eksplisit; login fallback mock sudah dihapus (login wajib server hidup).
  Seed data disamakan dua sisi (`backend/prisma/seed.ts` ↔ `apps/web-app/src/mock/data.ts`:
  bisnis Bean & Brew, staff Owner123!/Kasir123!/Barista123!, menu, meja `table-01..06`).
- Sorotan Fase 2: JWT httpOnly-cookie + Bearer (silent refresh), SSE per-bisnis,
  DOKU SNAP QRIS+VA (cash/qris/bank_transfer) + partnerReferenceNo unik per charge + recharge,
  manual order record-only + tendered/kembalian, inventory 2 tab (Receive/Adjustment + procurement),
  shift kas (opening/expected/closing/selisih), printer ESC/POS Bluetooth/USB real (LAN simulasi),
  tema self-order per kafe (preset + custom + preview), grafik recharts dari data asli,
  riwayat self-order per sesi pelanggan, foto HEIC→JPEG otomatis.

## 4. Cara jalan cepat (dev)

```bash
# Terminal 1 — backend (http://localhost:4000)
cd backend
cp .env.example .env
npm install
docker compose up -d        # Postgres + Adminer :8081 (JANGAN down -v: menghapus data!)
npx prisma generate
npx prisma migrate dev      # terapkan SEMUA migrasi (termasuk procurement/closing/theme)
npm run seed                # TRUNCATE + RESTART IDENTITY: ID kembali 1..N setiap seed
npm run dev                 # restart setiap ganti kode (wajib agar perubahan berlaku)

# Terminal 2 — web-app utama (http://localhost:5173)
cd apps/web-app
npm install
npm run dev
# Self-Order: http://localhost:5173/order/table-01
# Login:      http://localhost:5173/login

# Terminal 3 — landing page (http://localhost:5174, opsional)
cd apps/landing-page
npm install
npm run dev

# Terminal 4 — platform admin (http://localhost:5175, opsional)
cd apps/admin
npm install
npm run dev
```

> Catatan base path: `apps/web-app` kini memakai Vite `base: '/'` (sebelumnya `/Servopay/`),
> sehingga URL lama berbentuk `.../Servopay/order/...` tidak berlaku lagi.
> QR meja yang sudah tercetak ulang memakai `VITE_PUBLIC_BASE_URL` + `/order/:qrToken`.

> **Peringatan data:** `npm run seed` me-`TRUNCATE` semua tabel (ID restart). Jangan seed-ulang /
> `compose down -v` di environment berisi transaksi asli tanpa backup (`pg_dump` dulu).
> Jangan seed-ulang di environment yang sudah transaksi ke Midtrans (ID struk bisa lahir kembali;
> ID DOKU unik per charge menanggungnya, lihat `backend/README.md` §7).

## 5. Dokumentasi per sisi

- Backend: buka `backend/README.md` — stack, setup, akun seed, alur testing per endpoint (curl),
  daftar endpoint lengkap, aturan bisnis, DOKU (charge/webhook/recharge/ngrok), backup, menuju production.
- Web-app: buka `apps/web-app/README.md` — stack, rute per role, aturan bisnis, sinkronisasi realtime,
  tema, struktur folder aktual.
- Landing page: `apps/landing-page` — marketing publik, baca `GET /api/public/plans`, kirim `POST /api/public/leads`.
- Platform admin: `apps/admin` — dashboard internal di `:5175` (`/platform/*`): login superadmin/support,
  tenant + onboarding + ubah paket/status, override fitur, paket, invoice manual + CSV, leads, CMS landing,
  analitik + audit. Backend: `backend/README.md` § Platform Admin.
