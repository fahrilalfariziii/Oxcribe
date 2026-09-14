# Ordria Backend

Backend REST API + Realtime untuk aplikasi Coffee Shop Management (Self-Order, Frontoffice/POS,
BackOffice/Owner), dibangun sesuai skema & aturan bisnis di `../docs/prd_POS_updated.md`.

Project ini **berdiri sendiri** — semua endpoint bisa dites langsung lewat curl/Postman/Insomnia —
**dan** sudah dipakai `../apps/web-app` (REST + SSE). Alur §3 di bawah tetap valid sebagai dokumentasi API.

## Stack

- **Node.js + Express + TypeScript**
- **PostgreSQL** (lewat Docker Compose untuk development)
- **Prisma ORM** — schema & migrasi type-safe, gampang dipindah ke Postgres managed apa pun nanti
- **JWT + bcrypt** — autentikasi & hashing password sendiri (tidak bergantung ke Supabase Auth)
- **SSE (Server-Sent Events)** — realtime order baru & perubahan status (per-bisnis, HTTP murni tanpa WebSocket)
- **Zod + helmet + rate-limit + cookie-parser** — validasi input, security headers, anti brute-force/flood, httpOnly cookie
- Body JSON limit **5mb** (logo/foto dataURL dari frontend)

## 1. Setup

```bash
cd backend
cp .env.example .env
npm install

# Nyalakan PostgreSQL (+ Adminer, GUI DB via browser di http://localhost:8081)
docker compose up -d

# Generate Prisma Client dari schema.prisma
npx prisma generate

# Buat tabel-tabel di database (migrasi pertama)
npx prisma migrate dev --name init

# Isi data contoh (business "Bean & Brew", staff, menu, meja, bahan, 2 contoh order)
npm run seed

# Jalankan server dengan auto-reload
npm run dev
```

Server jalan di `http://localhost:4000`. Cek `GET http://localhost:4000/health` untuk memastikan hidup.

> **Catatan Docker:** kalau `docker compose` tidak tersedia, ganti dengan PostgreSQL lokal apa pun,
> lalu sesuaikan `DATABASE_URL` di `.env`. Prisma tidak peduli Postgres-nya jalan di Docker,
> instalasi lokal, atau managed service — schema & migrasi tetap sama persis.

## 2. Akun hasil seed

| Role    | Email               | Password    |
| ------- | ------------------- | ----------- |
| Owner   | owner@beanbrew.id   | Owner123!   |
| Kasir   | kasir@beanbrew.id   | Kasir123!   |
| Barista | barista@beanbrew.id | Barista123! |

QR token meja contoh: `table-01` s/d `table-06` (table-06 nonaktif).

Akun platform admin (login terpisah `POST /api/platform/auth/login`, cookie `platform_token`):

| Role       | Email              | Password   |
| ---------- | ------------------ | ---------- |
| Superadmin | admin@ordria.id  | Admin123!  |
| Support    | support@ordria.id | Support123! |

## 3. Alur testing tanpa frontend (curl / Postman)

> Semua contoh memakai base `http://localhost:4000`. Endpoint yang butuh login memakai
> header `Authorization: Bearer <token>`. Dapatkan token sekali via login, lalu pakai untuk
> semua request staff:
>
> ```bash
> curl -s -X POST http://localhost:4000/api/auth/login \
>   -H "Content-Type: application/json" \
>   -d '{"email":"owner@beanbrew.id","password":"Owner123!"}'
> # -> simpan "token" dari response
>
> TOKEN="<paste token di sini>"
> ```

### 3.1. Health & Auth — bisa diuji

```bash
# Health check (tanpa login)
curl -s http://localhost:4000/health

# Login (dapat JWT + info role/businessId)
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@beanbrew.id","password":"Owner123!"}'

# Profil user yang login
curl -s http://localhost:4000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

### 3.2. Self-Order pelanggan (tanpa login) — bisa diuji

```bash
# 1. Scan QR -> resolve meja + info bisnis (pajak/service + enabledPaymentMethods + paymentSettings)
curl -s http://localhost:4000/api/public/tables/table-01

# 2. Lihat katalog (pakai businessId dari response di atas)
curl -s http://localhost:4000/api/public/businesses/1/catalog

# 3. Checkout tunai (langsung pending manual)
curl -s -X POST http://localhost:4000/api/public/orders \
  -H "Content-Type: application/json" \
  -d '{
    "qrToken": "table-01",
    "customerName": "Budi",
    "paymentMethod": "cash",
    "items": [{ "productId": 1, "quantity": 1, "selectedOptionIds": [2, 4] }]
  }'

# 4. Checkout QRIS / E-Wallet / VA (trigger Midtrans charge otomatis bila
#    paymentSettings.<method>.gateway = "midtrans"; item_details produk+service+tax ikut terkirim)
curl -s -X POST http://localhost:4000/api/public/orders \
  -H "Content-Type: application/json" \
  -d '{
    "qrToken": "table-01",
    "customerName": "Sinta",
    "paymentMethod": "qris",
    "items": [{ "productId": 1, "quantity": 1 }]
  }'
# -> payments[0].gateway = "midtrans", gatewayData.qrUrl = URL QR PNG Midtrans

# 5. Polling status order (fallback selain SSE)
curl -s http://localhost:4000/api/public/orders/<clientOrderId-dari-response-checkout>

# 6. Polling status Midtrans + auto-sync paid (fallback webhook, tanpa perlu ngrok)
#    memakai midtransOrderId unik per charge (tersimpan di payments.gatewayData.orderId)
curl -s http://localhost:4000/api/public/orders/by-client/<clientOrderId>/status
# -> { order: {...paymentStatus...}, midtrans: { transaction_status } }
#    Jika Midtrans sudah settlement tapi lokal masih pending, endpoint ini otomatis menandai paid.

# 7. Terbitkan ulang QR/VA bila charge pertama gagal (ID Midtrans baru, order sama)
curl -s -X POST http://localhost:4000/api/public/orders/by-client/<clientOrderId>/recharge \
  -H "Content-Type: application/json" -d '{}'
```

### 3.3. Webhook Midtrans (butuh URL publik, mis. ngrok) — bisa diuji

```bash
# Set di .env: MIDTRANS_NOTIFICATION_URL=https://<xxx>.ngrok-free.app/api/public/midtrans/notification
# Midtrans akan POST ke sini saat status berubah (pending/settlement/expire).
# Verifikasi signature SHA512(order_id+status_code+gross_amount+ServerKey) otomatis;
# settlement -> order paid + emit SSE order:payment_updated.
# Lookup 2 lapis: cocok orderNumber persis, lalu payments.gatewayData.orderId (ID unik per charge).
curl -s http://localhost:4000/api/public/orders/by-client/<clientOrderId>/status
```

### 3.4. Orders staff (Frontoffice) — bisa diuji

```bash
# Feed order (filter opsional: ?status=diterima&source=self_order&paymentStatus=pending&limit=50)
curl -s "http://localhost:4000/api/orders?status=diterima" -H "Authorization: Bearer $TOKEN"

# Detail order
curl -s http://localhost:4000/api/orders/1 -H "Authorization: Bearer $TOKEN"

# Input pesanan manual kasir (source pos, paymentMethod: cash|qris|ewallet|bank_transfer)
curl -s -X POST http://localhost:4000/api/orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"customerName":"Walk-in","paymentMethod":"cash","items":[{"productId":1,"quantity":2}]}'

# Mode record-only kasir (tanpa Midtrans SEMUA metode, status pending, tendered/kembalian tersimpan)
curl -s -X POST http://localhost:4000/api/orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"customerName":"Walk-in","paymentMethod":"cash","recordOnly":true,"tendered":50000,"items":[{"productId":1,"quantity":2}]}'
# -> payments.gateway = "manual", gatewayData = { recordOnly, tendered, change }
#    cash dengan tendered < total -> 400 + order dibatalkan

# Ubah status (diterima -> diproses -> siap -> selesai)
curl -s -X PATCH http://localhost:4000/api/orders/1/status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"diproses"}'

# Catat/verifikasi pembayaran lunas (manual, mis. cash)
curl -s -X PATCH http://localhost:4000/api/orders/1/pay \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"method":"cash"}'
```

### 3.5. Business / Staff / Tables / Categories / Products — bisa diuji

```bash
# Profil bisnis (semua role boleh baca; ServerKey Midtrans tidak pernah di-expose)
curl -s http://localhost:4000/api/business -H "Authorization: Bearer $TOKEN"

# Update bisnis (owner only): identitas, pajak, service charge, metode pembayaran,
# paymentSettings per metode (gateway manual|midtrans), midtransMode global|custom, theme, qrTemplate
curl -s -X PUT http://localhost:4000/api/business \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"taxEnabled":true,"taxLabel":"PB1","taxRate":10,"enabledPaymentMethods":["cash","qris","bank_transfer"]}'

# Modal kas & suara (owner/kasir/barista): openingCash (buka shift baru), closingCash (tutup shift),
# soundEnabled — tanpa bisa menyentuh pajak/harga
curl -s -X PATCH http://localhost:4000/api/business/cash-settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"openingCash":500000}'

# Staff (owner only)
curl -s http://localhost:4000/api/staff -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:4000/api/staff \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Dedi Kasir","email":"dedi@beanbrew.id","password":"Dedi123!","role":"kasir"}'

# Meja (list: staff; tambah/edit/regenerate-qr/hapus: owner only)
curl -s http://localhost:4000/api/tables -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:4000/api/tables \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tableNumber":"07","area":"Indoor"}'

# Kategori (list: staff; tulis: owner only)
curl -s http://localhost:4000/api/categories -H "Authorization: Bearer $TOKEN"

# Produk (list: staff; CRUD + opsi: owner only; toggle availability: semua staff)
curl -s http://localhost:4000/api/products -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH http://localhost:4000/api/products/1/availability \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isAvailable":false}'
```

### 3.6. Ingredients & Analytics — bisa diuji

```bash
# Bahan (tambah/edit: owner/kasir/barista; nonaktifkan: owner only)
curl -s -X POST http://localhost:4000/api/ingredients \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Gula Aren","unit":"kg","currentStock":10,"minimumStock":2}'

# Catat pergerakan stok (satu-satunya cara mengubah current_stock; SEMUA tipe terbuka semua staff)
# - in (receive): qty>0 + opsional supplier/referenceNo/unitCost/batchNo/expiryDate
# - adjustment: qty +/-(≠0) + WAJIB reason (waste_damage|variance_missing|internal_promo|correction)
curl -s -X POST http://localhost:4000/api/ingredients/1/movements \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"in","quantity":5,"notes":"Restock","supplier":"PT Kopi","referenceNo":"SJ-001"}'
curl -s -X POST http://localhost:4000/api/ingredients/1/movements \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"adjustment","quantity":-2,"reason":"waste_damage","notes":"Susu basi"}'
curl -s http://localhost:4000/api/ingredients/1/movements -H "Authorization: Bearer $TOKEN"
# Status isAvailable otomatis: habis (<=0) -> false; terisi dari kosong -> true

# Analytics (period = daily|weekly|monthly)
curl -s "http://localhost:4000/api/analytics/dashboard?period=daily" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:4000/api/analytics/sales?period=weekly" -H "Authorization: Bearer $TOKEN"
```

**Realtime (SSE):** pelanggan subscribe via `GET /api/public/stream?qrToken=<qr-meja>`
(businessId di-resolve server, bukan dipercaya dari client); staff via `?token=JWT`.
Dengarkan event `order:new`, `order:status_updated`, `order:payment_updated`,
`product:availability_updated` (CRUD produk/kategori/opsi juga emit ini),
`ingredient:stock_updated`, `business:cash_updated`, `business:updated`.
Reconnect otomatis via EventSource + replay `Last-Event-ID`; set `REDIS_URL`
(Upstash) untuk fan-out lintas instance, tanpa itu mode in-process.

## 4. Struktur folder

```
backend/
├── prisma/
│   ├── schema.prisma      # 12 tabel sesuai ERD di PRD §6
│   └── seed.ts            # data contoh (samakan dengan apps/web-app/src/mock/data.ts)
└── src/
    ├── index.ts           # bootstrap: http server + initRealtime + listen
    ├── app.ts             # express app, middleware, mount /api
    ├── lib/               # prisma client, jwt, password, kalkulasi order, realtime (SSE)
    ├── middleware/         # auth (JWT + role guard), error handler
    ├── services/           # logika inti: create order, ubah status, catat pembayaran
    └── routes/             # 1 file per resource (REST endpoints)
```

## 5. Daftar Endpoint (semua bisa diuji via §3)

### Publik (tanpa login — Self-Order pelanggan + webhook Midtrans)

| Method | Path                                            | Keterangan                                                        |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/public/tables/:qrToken`                   | Resolve meja + info bisnis (pajak/service/metode pembayaran)       |
| GET    | `/api/public/businesses/:id/catalog`            | Katalog kategori+produk+opsi tersedia                              |
| GET    | `/api/public/plans`                             | Daftar paket SaaS (Starter/Pro/Enterprise) untuk Landing Page      |
| POST   | `/api/public/leads`                             | Form konsultasi sales `/hubungi-sales` (tersimpan di `backend/data/leads.json`) |
| POST   | `/api/public/orders`                            | Checkout (cash manual / qris-ewallet-VA via Midtrans bila aktif)   |
| POST   | `/api/public/orders/by-client/:clientOrderId/recharge` | Terbitkan ulang charge Midtrans (ID unik baru) untuk order pending yang QR/VA-nya gagal terbit |
| GET    | `/api/public/orders/:clientOrderId`             | Cek status order (polling fallback)                                |
| GET    | `/api/public/orders/by-number/:orderNumber/status` | Polling status Midtrans + auto-sync paid + fallbackQrUrl QRIS   |
| POST   | `/api/public/midtrans/notification`             | Webhook Midtrans (verify signature, settlement→paid otomatis, expire/deny/cancel→failed + auto-batal) |

### Auth

| Method | Path              | Keterangan                                   |
| ------ | ----------------- | --------------------------------------------- |
| POST   | `/api/auth/login` | Login, dapat JWT (httpOnly cookie + Bearer)   |
| GET    | `/api/auth/me`    | Profil user yang login                        |
| POST   | `/api/auth/refresh` | Silent refresh token (7 hari, sliding)      |
| POST   | `/api/auth/logout` | Hapus cookie sesi                            |
| PATCH  | `/api/auth/password` | Ganti password sendiri (semua role, verifikasi bcrypt) |
| POST   | `/api/auth/forgot-password` | Minta link reset (khusus owner; selalu 200; token 1 jam, sekali pakai; tanpa SMTP link hanya di console dev) |
| POST   | `/api/auth/reset-password` | Tukar token menjadi password baru (validasi kuat) |

### Business (owner untuk update)

| Method | Path            | Role  | Keterangan                                                              |
| ------ | --------------- | ----- | ------------------------------------------------------------------------ |
| GET    | `/api/business` | staff | Profil bisnis (tanpa ServerKey Midtrans, ada flag hasMidtransCustomKey)  |
| PUT    | `/api/business` | owner | Identitas, pajak, service, enabledPaymentMethods, paymentSettings (channel/bank VA, midtransMode), midtransMode/custom + ServerKey terenkripsi, theme, qrTemplate (nullable). `gateway`/`instruction` lama tetap diterima tapi diabaikan (non-cash selalu Midtrans) |
| PATCH  | `/api/business/cash-settings` | owner,kasir,barista | Buka/tutup shift (`openingCash` reset closing, `closingCash` + `cashClosedAt` otomatis, `soundEnabled`) + emit `business:cash_updated`; PUT emit `business:updated` |

### Staff (owner only)

| Method | Path             | Keterangan                                   |
| ------ | ---------------- | --------------------------------------------- |
| GET    | `/api/staff`     | List staff                                    |
| POST   | `/api/staff`     | Tambah staff (password strong 8+)             |
| PUT    | `/api/staff/:id` | Edit staff (nama/email/role/active; password opsional = tidak diubah) |
| DELETE | `/api/staff/:id` | Nonaktifkan staff (soft delete)               |

### Tables (meja)

| Method | Path                             | Role  | Keterangan            |
| ------ | -------------------------------- | ----- | ---------------------- |
| GET    | `/api/tables`                    | staff | List meja               |
| POST   | `/api/tables`                    | owner | Tambah meja (auto QR token) |
| PUT    | `/api/tables/:id`                | owner | Edit meja               |
| POST   | `/api/tables/:id/regenerate-qr`  | owner | Ganti QR token           |
| DELETE | `/api/tables/:id`                | owner | Hapus meja               |

### Categories & Products

| Method | Path                                             | Role         | Keterangan                    |
| ------ | ------------------------------------------------- | ------------ | ------------------------------ |
| GET    | `/api/categories`                                  | staff        | List kategori                  |
| POST/PUT/DELETE | `/api/categories(/:id)`                   | owner        | CRUD kategori                  |
| GET    | `/api/products`                                    | staff        | List produk + opsi              |
| POST/PUT/DELETE | `/api/products(/:id)`                     | owner        | CRUD produk                     |
| PATCH  | `/api/products/:id/availability`                   | staff        | Toggle Out of Stock cepat        |
| POST/PUT/DELETE | `/api/products/:id/options(/:optionId)`   | owner        | CRUD varian/add-ons              |

### Orders

| Method | Path                     | Role  | Keterangan                              |
| ------ | ------------------------ | ----- | ----------------------------------------- |
| GET    | `/api/orders`            | staff | Feed order (filter status/source/payment) |
| GET    | `/api/orders/:id`        | staff | Detail order                              |
| POST   | `/api/orders`            | staff | Manual kasir; `recordOnly:true` = tanpa Midtrans + `tendered`/`change` |
| PATCH  | `/api/orders/:id/status` | staff | Ubah status (diterima→diproses→siap→selesai→batal; batal bersifat final) |
| PATCH  | `/api/orders/:id/pay`    | owner,kasir | Catat lunas manual (cash; non-cash hanya via webhook/polling) |
| PATCH  | `/api/orders/:id/cancel` | staff | Batalkan order belum lunas (masuk riwayat; tolak bila paid/selesai) |

### Ingredients & Stock Movements

| Method | Path                          | Keterangan                                  |
| ------ | ----------------------------- | --------------------------------------------|
| GET    | `/api/ingredients`            | List bahan (semua staff)                     |
| POST   | `/api/ingredients`            | Tambah bahan (owner/kasir/barista)           |
| PUT    | `/api/ingredients/:id`        | Edit info bahan, tanpa currentStock (owner/kasir/barista) |
| DELETE | `/api/ingredients/:id`        | Nonaktifkan bahan (owner only)               |
| GET    | `/api/ingredients/:id/movements` | Riwayat pergerakan stok                   |
| POST   | `/api/ingredients/:id/movements` | Catat stok, semua staff (aturan per tipe, lihat §3.6) |

### Analytics (BackOffice)

| Method | Path                                        | Keterangan                                  |
| ------ | -------------------------------------------- | --------------------------------------------|
| GET    | `/api/analytics/dashboard?period=daily\|weekly\|monthly` | Omset, total order, avg, top 5 produk |
| GET    | `/api/analytics/sales?period=daily\|weekly\|monthly`     | Deret omset per waktu + Self Order vs POS |

Semua endpoint yang butuh login memakai header `Authorization: Bearer <token>`.

### Platform Admin (internal — Fase 3 SaaS)

Login terpisah dari staff tenant (JWT `scope: platform`, cookie `platform_token`).
Token tenant ditolak di sini dan sebaliknya. Role `support` read-only untuk
billing (buat/bayar invoice), tulis paket, dan reset password owner (403).

```bash
PTOKEN=$(curl -s -X POST http://localhost:4000/api/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ordria.id","password":"Admin123!"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# Daftar tenant + onboarding + ubah paket/status
curl -s http://localhost:4000/api/platform/tenants -H "Authorization: Bearer $PTOKEN"
curl -s http://localhost:4000/api/platform/tenants/1 -H "Authorization: Bearer $PTOKEN"
curl -s -X PATCH http://localhost:4000/api/platform/tenants/1/plan \
  -H "Authorization: Bearer $PTOKEN" -H "Content-Type: application/json" \
  -d '{"planCode":"starter"}'

# Billing manual + CMS landing + analytics + audit + leads
curl -s -X POST http://localhost:4000/api/platform/invoices \
  -H "Authorization: Bearer $PTOKEN" -H "Content-Type: application/json" \
  -d '{"businessId":1,"amount":249000}'
curl -s http://localhost:4000/api/platform/landing-content -H "Authorization: Bearer $PTOKEN"
curl -s http://localhost:4000/api/public/landing-content
curl -s http://localhost:4000/api/platform/analytics/overview -H "Authorization: Bearer $PTOKEN"
curl -s "http://localhost:4000/api/platform/audit-logs?limit=5" -H "Authorization: Bearer $PTOKEN"
```

| Method | Path | Role | Keterangan |
| ------ | ---- | ---- | ---------- |
| POST | `/api/platform/auth/login` | publik | Login admin, cookie `platform_token` |
| GET | `/api/platform/auth/me` | admin | Profil admin |
| POST | `/api/platform/auth/logout` | admin | Hapus cookie |
| GET | `/api/platform/tenants` | admin | Daftar + agregat (filter plan/status/q) |
| POST | `/api/platform/tenants` | admin | Onboarding (langsung `active`, tanpa trial) |
| GET | `/api/platform/tenants/:id` | admin | Detail + agregat + riwayat audit |
| PATCH | `/api/platform/tenants/:id/plan` | admin | Upgrade/downgrade (data historis aman) |
| PATCH | `/api/platform/tenants/:id/status` | admin | active/past_due/suspended/canceled |
| POST | `/api/platform/tenants/:id/reset-owner-password` | superadmin | Reset darurat |
| PATCH/DELETE | `/api/platform/tenants/:id/feature-overrides` | admin | Override per-key / reset ke paket |
| PATCH | `/api/platform/tenants/:id/platform-fee` | admin | Platform fee self-order per kafe (%/flat + bearer, audit `platform_fee_changed`) |
| GET/PUT | `/api/platform/plans(/:code)` | admin/superadmin | Lihat semua / ubah paket |
| GET/POST | `/api/platform/invoices` | admin/superadmin | List / buat manual |
| PATCH | `/api/platform/invoices/:id/pay` | superadmin | Tandai lunas manual |
| GET | `/api/platform/invoices/export.csv` | admin | Export CSV |
| GET/PUT | `/api/platform/landing-content` | admin | CMS landing (publish) |
| GET | `/api/public/landing-content` | publik | Konten published untuk landing |
| GET | `/api/platform/analytics/overview` | admin | Tenant per paket, baru/bulan, MRR |
| GET | `/api/platform/audit-logs` | admin | Filter bisnis/aksi |
| GET/PATCH | `/api/platform/leads(/:id)` | admin | Tinjau lead |

Feature gate tenant (paket Starter ditolak 403 dengan pesan upgrade):
self-order publik (`POST /api/public/orders`, recharge), seluruh `/api/ingredients`,
tulis `/api/tables`, field `theme` di `PUT /api/business`. Suspended tenant ditolak
di semua endpoint operasional.

## 6. Aturan bisnis penting yang sudah diimplementasikan

- **Kalkulasi total** persis mengikuti rumus di `frontend/src/mock/store.tsx`: `service = subtotal * (serviceChargeRate/100)`, `tax = (subtotal+service) * (taxRate/100)`, `total = subtotal+service+(taxBearer==='cafe' ? 0 : tax)`.
- **Idempotency**: `clientOrderId` unik — kalau dikirim ulang (retry offline sync), order lama dikembalikan, tidak dibuat dobel.
- **Nomor order unik** dengan retry otomatis kalau terjadi race condition antar request paralel.
- **Snapshot harga**: `order_items.price` & `product_name` disimpan saat transaksi dibuat, tidak berubah walau harga produk diedit belakangan.
- **Stock movement wajib**: `current_stock` bahan **hanya** bisa berubah lewat endpoint `POST /ingredients/:id/movements`, setiap perubahan otomatis tercatat sebagai riwayat.
- **Status bahan otomatis**: stok habis (≤0) → `isAvailable=false`; terisi dari kosong → `true`; selain itu hormati flag manual.
- **Validasi toleran**: angka (`price`, `quantity`, `minimumStock`, …) memakai `z.coerce` (terima `"5"` maupun `5`); string opsional memakai `nullish→undefined` (`null` = tidak diubah, bukan 400).
- **Manual record-only**: `POST /api/orders` dengan `recordOnly:true` melewati Midtrans untuk semua metode; `tendered`/`change` tersimpan di `payments.gatewayData`.
- **business_id di semua tabel operasional** — fondasi SaaS-ready sesuai PRD, walau saat ini baru dipakai untuk 1 bisnis.
- **Realtime** order baru & perubahan status langsung di-broadcast via SSE per bisnis.

## 7. Midtrans (sudah terintegrasi, bukan roadmap)

- **ID unik per charge:** nomor struk (`BE-9028`) boleh berulang (mis. habis seed ulang),
  tapi setiap charge memakai `midtransOrderId = <orderNumber>-<base36 timestamp>` yang unik
  selamanya — QRIS menolak `order_id` duplikat (VA mentoleransinya). ID tersimpan di
  `payments.gatewayData.orderId`; polling status & webhook memakai ID itu, bukan nomor struk.
  Jangan `TRUNCATE`/seed-ulang di environment yang sudah transaksi ke gateway tanpa sadar
  konsekuensinya (untuk charge lama pra-ID-unik, webhook fallback cocokkan `orderNumber`).

- QRIS tanpa `qris.acquirer` (ikut default GoPay Midtrans, object `qris` Optional sesuai docs).
- `POST /api/public/orders` & `POST /api/orders` SELALU charge Midtrans untuk non-cash
  (qris / VA bca-mandiri-bni-bri); nilai `gateway` lama diabaikan;
- Metode: `cash|qris|bank_transfer` (e-wallet dihapus). SeaBank TIDAK didukung Core API
  klasik (hanya via BI-SNAP, di luar scope) — jangan ditambahkan ke allowlist.
- Mandiri = Bill Payment: wajib `bill_info1/2` (dikirim otomatis, bill_info2 = ID order unik);
  respons berupa `bill_key` yang dipetakan ke kolom VA di aplikasi.
  `item_details` produk + Service Charge + Tax ikut terkirim (sum == total, kalau tidak cocok di-omit agar charge tetap sukses).
- `payments.gateway = "midtrans"`, `reference = transaction_id`,
  `gatewayData = { qrUrl, qrString, vaNumber, redirectUrl, raw, lastNotification }`
  (merge — webhook `pending` tidak menghapus `qrUrl` charge).
- Webhook `POST /api/public/midtrans/notification` verifikasi `SHA512(order_id+status_code+gross_amount+ServerKey)`;
  butuh URL publik — lokal pakai ngrok: `MIDTRANS_NOTIFICATION_URL=https://<xxx>.ngrok-free.app/api/public/midtrans/notification`.
- Tanpa ngrok, pakai `GET /api/public/orders/by-number/:orderNumber/status` untuk poll + auto-sync `paid`.
- Isi `.env`: `MIDTRANS_SERVER_KEY=SB-Mid-server-...`, `MIDTRANS_IS_PRODUCTION=false` untuk Sandbox.

## 8. Backup database (penting!)

Database dev memakai Docker volume (`backend_servopay_db_data`). Berlaku:

- `docker compose down` = aman (data tetap). **`docker compose down -v` / `prune` = DATA HILANG.**
- `npm run seed` me-`TRUNCATE` semua tabel + restart sequence — hanya untuk dev kosong.
- Backup sebelum operasi berisiko:
  ```bash
  docker exec servopay-db pg_dump -U servopay servopay > backups/servopay-$(date +%F).sql
  # restore:
  Get-Content backups/servopay-2026-09-09.sql | docker exec -i servopay-db psql -U servopay -d servopay
  ```
- Production: Postgres managed dengan PITR (wajib) — lihat §9.

## 9. Menuju production nanti

1. Sewa Postgres managed (Neon/Railway/RDS/Supabase/dll) atau tetap Docker di VPS.
2. Ganti `DATABASE_URL` di `.env` production.
3. `npx prisma migrate deploy` (bukan `migrate dev`) untuk menerapkan migrasi tanpa prompt interaktif.
4. Ganti `JWT_SECRET` dengan string acak panjang yang benar-benar rahasia.
5. Set `CORS_ORIGIN` ke domain frontend production.
6. Ganti `MIDTRANS_IS_PRODUCTION=true` + ServerKey production + `MIDTRANS_NOTIFICATION_URL` domain publik.
