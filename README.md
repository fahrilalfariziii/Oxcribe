# OXCRIBE — Coffee Shop Management (Self-Order QR + POS + SaaS Multi-Tenant)

Oxcribe mendigitalkan operasional coffee shop dari hulu ke hilir: pelanggan memesan sendiri
lewat QR di meja (**Self-Order**), pesanan masuk real-time ke kasir/barista (**Frontoffice/POS**),
owner memantau omset dan mengelola katalog (**BackOffice**), dan tim internal mengelola banyak
kafe yang berlangganan (**Platform Admin**) dengan **Landing Page** publik sebagai pintu akuisisi.

Spesifikasi produk lengkap ada di `docs/`:
- `prd_POS_updated.md` — domain operasional (Self-Order, Frontoffice, BackOffice, skema 12 tabel).
  Dokumen historis Fase 0–2; lihat header status di dalamnya untuk divergensi as-built.
- `prd_SaaS_multitenant.md` — layer SaaS Fase 3 (paket Starter/Pro/Enterprise, feature gating,
  Platform Admin, landing). Dokumen historis; lihat header status di dalamnya.
- `Operasional-DOKU.md` — **runbook pembayaran & pencairan DOKU** (wajib dibaca sebelum
  menyentuh dana: Pending vs IDR, settlement H+1, split rule, payout, tabel error).

## 1. Peta monorepo & port

```
servopay/                      # nama folder historis; brand produk = Oxcribe
├── docs/                      # PRD + runbook operasional
├── backend/                   # REST API + Realtime SSE + DOKU (Node.js/Express/Prisma/Postgres)
│   └── README.md              # setup, akun seed, SEMUA endpoint + contoh curl, DOKU, backup
└── apps/
    ├── web-app/               # Aplikasi Oxcribe utama (Self-Order, Frontoffice, BackOffice)
    │   └── README.md          # rute per role, aturan bisnis, realtime, struktur folder
    ├── landing-page/          # Website marketing publik + CMS konten
    │   └── README.md          # rute, section CMS, API publik yang dipakai
    └── admin/                 # Dashboard Platform Admin internal
        └── README.md          # rute, role, semua halaman, operasi DOKU di UI
```

| Layanan      | Dev URL               | Prod (contoh)        | Catatan                              |
| ------------ | --------------------- | -------------------- | ------------------------------------ |
| Backend API  | `http://localhost:4000` | `https://api.oxcribe.id` | Health: `GET /health`              |
| Web-app      | `http://localhost:5173` | `https://app.oxcribe.id` | Self-Order: `/order/:qrToken`      |
| Landing page | `http://localhost:5174` | `https://oxcribe.id`     | Publik, tanpa login                |
| Platform admin | `http://localhost:5175` | `https://admin.oxcribe.id` | Login terpisah, cookie terpisah  |
| Postgres     | `localhost:5432`      | managed (Neon/RDS/dll) | Via Docker Compose saat dev        |
| Adminer      | `http://localhost:8081` | —                  | GUI database dev (opsional)          |

> Riwayat: folder `frontend/` dipindah ke `apps/web-app/` via `git mv` (history git dipertahankan).
> Nama teknis peninggalan (`servopay` di nama package, database, Docker, localStorage keys)
> disengaja **belum** diganti agar tidak memicu migrasi data — lihat §5.

## 2. Cara menjalankan (dev)

```bash
# Terminal 1 — backend (http://localhost:4000)
cd backend
cp .env.example .env            # lalu isi kredensial DOKU sandbox bila ingin uji QRIS/VA
npm install
docker compose up -d            # Postgres + Adminer :8081 (JANGAN down -v: menghapus data!)
npx prisma generate
npx prisma migrate dev          # terapkan SEMUA migrasi
npm run seed                    # TRUNCATE + RESTART IDENTITY (baca §5 dulu!)
npm run dev                     # auto-reload setiap ganti kode (wajib agar perubahan berlaku)

# Terminal 2 — web-app utama (http://localhost:5173)
cd apps/web-app
npm install
npm run dev
# Self-Order: http://localhost:5173/order/<qrToken-meja-aktif>  (lihat §6: QR dinamis!)
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

Cek kesehatan tiap lapis sebelum menguji alur:

```bash
curl -s http://localhost:4000/health
# -> {"status":"ok","service":"oxcribe-backend",...}
```

## 3. Status integrasi (Fase 2–3 — FE↔BE tersambung + SaaS)

- **Backend berdiri sendiri** — semua endpoint bisa dites langsung via curl/Postman tanpa frontend
  (lihat `backend/README.md` §3: health, auth, self-order publik, plans/leads publik, orders,
  business, staff, tables, products, ingredients, analytics, platform admin, webhook DOKU).
- **Web-app terintegrasi BE** — halaman kasir & owner memuat/menyimpan via REST + realtime **SSE**
  (`GET /api/stream`). Fallback lokal (seed `apps/web-app/src/mock/data.ts`) hanya dipakai saat
  server tak terjangkau, dengan banner "Mode lokal" yang eksplisit; login fallback mock sudah
  dihapus (**login wajib server hidup**). Seed data disamakan dua sisi
  (`backend/prisma/seed.ts` ↔ `apps/web-app/src/mock/data.ts`).
- **Pembayaran: DOKU SNAP Direct API** (QRIS MPM + VA BCA/Mandiri/BNI/BRI), custom UI penuh —
  bukan hosted checkout. `cash` selalu manual; `qris`/`bank_transfer` selalu charge DOKU
  (`partnerReferenceNo` unik per charge, pola `<orderNumber>-<base36 timestamp>`).
  E-wallet **dihapus** dari metode. Detail di `backend/README.md` §7 dan `docs/Operasional-DOKU.md`.
- **Realtime: SSE per-bisnis** (bukan Socket.io/WebSocket): `order:new`, `order:status_updated`,
  `order:payment_updated`, `product:availability_updated`, `ingredient:stock_updated`,
  `business:cash_updated`, `business:updated`. Reconnect otomatis via `Last-Event-ID`;
  Redis opsional untuk fan-out lintas instance.
- **SaaS Fase 3**: paket Starter/Pro/Enterprise + feature gate otoritatif di backend
  (`plans.feature_flags` + `featureOverrides` per tenant), Platform Admin terpisah
  (JWT `scope: platform`, cookie `platform_token`), audit trail aksi sensitif.
- Sorotan lain: JWT httpOnly-cookie + Bearer (silent refresh), manual order record-only +
  tendered/kembalian, inventory 2 tab (Receive/Adjustment + procurement), shift kas
  (opening/expected/closing/selisih), printer ESC/POS Bluetooth/USB real (LAN simulasi),
  tema self-order per kafe (preset + custom + preview), grafik recharts dari data asli,
  riwayat self-order per sesi pelanggan, foto HEIC→JPEG otomatis, halaman Pengguna
  (Internal vs Merchant), transfer/payout DOKU per tenant + verifikasi rekening settlement.

## 4. Akun seed & autentikasi ganda

| Area     | Login                  | Akun dev (hasil seed)                        |
| -------- | ---------------------- | -------------------------------------------- |
| Tenant   | `POST /api/auth/login` | `owner@beanbrew.id` / `Owner123!` (owner), `kasir@beanbrew.id` / `Kasir123!`, `barista@beanbrew.id` / `Barista123!` |
| Platform | `POST /api/platform/auth/login` | `admin@oxcribe.id` / `Admin123!` (superadmin), `support@oxcribe.id` / `Support123!` (support, read-only billing) |

Dua sistem sesi **terisolasi penuh**: token/cookie tenant tidak berlaku di endpoint platform
dan sebaliknya. Role `support` read-only untuk billing dan tidak bisa reset password owner.

## 5. Peringatan data (baca sebelum seed / drop volume!)

- `npm run seed` me-`TRUNCATE` semua tabel + restart sequence — **hanya untuk dev kosong**.
  Jangan seed-ulang / `compose down -v` di environment berisi transaksi asli tanpa backup
  (`pg_dump` dulu — lihat `backend/README.md` §8).
- **Seed ≠ database aktif.** Mengubah file `prisma/seed.ts` (mis. email admin baru) TIDAK
  mengubah baris yang sudah ada di database. Untuk database dev yang sudah jalan, pindahkan
  data dengan `UPDATE` manual (backup dulu) atau reseed dari nol. Contoh mengganti email admin:
  ```sql
  -- backup dulu, lalu:
  UPDATE platform_admins SET email = 'admin@oxcribe.id' WHERE email = 'admin@ordria.id';
  UPDATE users SET email = '...' WHERE ...;  -- hanya bila diperlukan
  ```
- Jangan seed-ulang di environment yang sudah transaksi ke DOKU (nomor struk bisa lahir
  kembali; `partnerReferenceNo` unik per charge menanggungnya, tapi riwayat `gateway:"doku"`
  lama tak bisa di-query lagi ke gateway).
- Nomor struk (`BE-xxxx`) boleh berulang antar seed; yang unik selamanya adalah
  `partnerReferenceNo` per charge.

## 6. QR meja itu dinamis (jangan hardcode `table-01`)

Token QR bisa di-regenerate owner kapan saja (`POST /api/tables/:id/regenerate-qr`), dan meja
bisa dinonaktifkan. Contoh lama `table-01` **belum tentu valid** — selalu resolve dulu:

```bash
TOKEN="<token-atau-qr-meja>"   # mis. dari GET /api/tables (login staff)
curl -s http://localhost:4000/api/public/tables/$TOKEN
# 404 "QR meja tidak valid atau tidak aktif" = token salah / meja nonaktif
```

URL Self-Order production memakai `VITE_PUBLIC_BASE_URL + /order/:qrToken`; QR yang sudah
tercetak harus dicetak ulang setiap token berubah (halaman BackOffice → Meja).

## 7. Dokumentasi per sisi

- Backend: `backend/README.md` — stack, setup, akun seed, alur testing per endpoint (curl),
  daftar endpoint lengkap (termasuk Platform Admin: tenants, users, admins, plans, invoices,
  settlement, split-rule, transfer), aturan bisnis, DOKU (charge/webhook/recharge/ngrok),
  backup, menuju production.
- Web-app: `apps/web-app/README.md` — stack, rute per role, aturan bisnis, sinkronisasi
  realtime, tema, struktur folder aktual.
- Landing page: `apps/landing-page/README.md` — marketing publik (`GET /api/public/plans`,
  `POST /api/public/leads`, CMS `landing-content`).
- Platform admin: `apps/admin/README.md` — dashboard internal `:5175` (`/platform/*`):
  tenants, pengguna (Internal/Merchant), paket, invoice, leads, CMS, analitik, audit,
  operasi DOKU (register, split rule, settlement, payout).
- Operasional dana: `docs/Operasional-DOKU.md` — wajib dibaca sebelum payout.
