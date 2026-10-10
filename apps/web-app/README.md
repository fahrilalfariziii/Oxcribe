# Oxcribe Frontend

Web App Coffee Shop Management — tiga area: **Self-Order pelanggan (mobile)**,
**Frontoffice kasir/barista (desktop)**, **BackOffice owner (desktop)**.

> **Terintegrasi backend** (`CafeProvider` di `src/mock/store.tsx` BE-first via `src/lib/api.ts`
> + realtime SSE `src/lib/stream.ts`). Seed `src/mock/data.ts` hanya fallback saat server tak terjangkau
> (dengan banner "Mode lokal"); **login wajib server hidup** (fallback mock dihapus).

## Login

Email + password, auto-detect role, redirect role-based. Refresh tidak menendang ke login
(`isHydrating` guard menunggu pemulihan sesi dulu). Tanpa sesi → `/login?next=…`.

| Role    | Redirect setelah login              |
| ------- | ----------------------------------- |
| Owner   | `/backoffice/dashboard`             |
| Kasir   | `/frontoffice/orders`               |
| Barista | `/frontoffice/orders`               |

QR token meja contoh: `table-01` s/d `table-05` aktif, `table-06` nonaktif — **saat seed**.
Token QR itu dinamis (owner bisa regenerate); bila 404 "QR tidak valid", ambil token aktif
dari BackOffice → Meja atau `GET /api/tables` (login staff).
Akses Self-Order: `http://localhost:5173/order/table-01`
(kredensial dev = seed backend; tidak dipajang di UI).

## Stack

- **React 19 + TypeScript + Vite**
- **React Router** (`base='/'`, alias legacy `/pos/*` → `/frontoffice`, `/owner/*` → `/backoffice`)
- **Tailwind CSS 4** + font `Fraunces`/`Inter` + `material-symbols`
- **recharts** (grafik owner, data asli) + `heic2any` (lazy, konversi HEIC iPhone → JPEG)
- State: **React Context** (`CafeProvider`); riwayat self-order per sesi di localStorage

## Setup

```bash
cd frontend
npm install

# Jalankan dev server
npm run dev

# Env (lihat .env.example):
# VITE_API_BASE_URL=http://localhost:4000  # backend
# VITE_PUBLIC_BASE_URL=                     # domain publik untuk QR meja (wajib di production!)

# Cek type + build production (wajib lolos sebelum commit)
npm run build
```

- Dev server: `http://localhost:5173`
- Self-Order: `http://localhost:5173/order/table-01`
- Login: `http://localhost:5173/login`

## Rute & guard role

| Path                          | Role                    | Keterangan                              |
| ----------------------------- | ----------------------- | ---------------------------------------- |
| `/`                           | publik                  | Redirect role-based (login/dashboard)    |
| `/login`                      | publik                  | Email+password global Oxcribe, tanpa dropdown role |
| `/lupa-password`              | publik                  | Minta link reset password owner via email        |
| `/reset-password?token=`      | publik                  | Buat password baru dari link email (1 jam, sekali pakai) |
| `/order/:token`               | publik (pelanggan)      | Menu → Cart → Payment → Status → **Riwayat** |
| `/frontoffice/orders`         | kasir, barista, owner   | Live Orders: suara ±3,5 dtk + toast + title flash; Tandai Lunas khusus cash; tombol Proses hanya bila lunas; Batalkan order belum lunas; gagal/expired auto-batal masuk riwayat |
| `/frontoffice/manual`         | kasir, barista, owner   | Manual record-only (pending, tendered/kembalian, tanpa DOKU) |
| `/frontoffice/catalog`        | kasir, barista, owner   | Toggle Out of Stock (popup konfirmasi) + peringatan stok bahan |
| `/frontoffice/inventory`      | kasir, barista, owner   | Tab Penerimaan (supplier/nota/harga/batch/expired) & Penyesuaian (reason wajib) |
| `/frontoffice/settings`       | kasir, barista, owner   | Perangkat (BT/USB real, LAN simulasi), Modal Kas (expected/closing/selisih), Akun & Sesi |
| `/backoffice/dashboard`       | owner                   | Line chart omset real + Best Selling     |
| `/backoffice/sales/omset`     | owner                   | Line chart omset + Self vs Manual        |
| `/backoffice/sales/performa`  | owner                   | Bar/donut performa menu/kategori/varian  |
| `/backoffice/sales/riwayat`   | owner                   | Riwayat + paginasi 10/30/50/100          |
| `/backoffice/menu/catalog`    | owner                   | CRUD menu (drawer) + foto upload/URL + varian |
| `/backoffice/menu/categories` | owner                   | CRUD kategori                            |
| `/backoffice/menu/variants`   | owner                   | CRUD varian & add-ons (endpoint options) |
| `/backoffice/tables`          | owner                   | Meja + QR preview/print/download/salin-link/regenerate + Edit Struk global |
| `/backoffice/staff`           | owner                   | CRUD staff (password opsional saat edit) |
| `/backoffice/settings/profile`  | owner                 | Profil (nama/email editable) + ganti password (verifikasi server) |
| `/backoffice/settings/business` | owner                 | Tab Profil (identitas + logo) & Tema (preset + custom + preview HP) |
| `/backoffice/settings/tax`      | owner                 | Pajak PB1/PBJT/PPN + bearer + service    |
| `/backoffice/settings/payment`  | owner                 | Metode aktif (non-cash selalu DOKU) + channel/bank VA + konfigurasi DOKU |

## Aturan bisnis di frontend (sinkron dengan backend)

- Total: `service = subtotal*rate`, `taxBase = subtotal+service`, `tax = taxBase*rate`,
  `total = subtotal+service + (taxBearer==='cafe' ? 0 : tax)` — sama dengan `backend/src/lib/order-calc.ts`.
- Katalog tampil harga penuh `Rp 30.000` (`formatRupiah`), bukan `Rp 30k`.
- Metode pembayaran Self-Order difilter dari `business.enabledPaymentMethods`
  (Tunai, QRIS, Transfer Bank BCA/Mandiri/BNI/BRI) + berubah live via SSE `business:updated`.
- `PaymentMethod` valid: `cash|qris|bank_transfer` (sinkron dengan backend; e-wallet dihapus).
- Tema self-order (`BusinessTheme` + `normalizeTheme`): primer/aksen/latar/header/sapaan/font/radius;
  tanpa tema = tampilan default. Berlaku di Menu, Cart, ItemSheet, Payment, Status, Riwayat, BottomNav.
- Error API jujur: detail `fieldErrors` Zod dirangkum ke toast (mis. `badge: Expected string, received null`);
  403 peran menyarankan logout/login ulang; `null`/`undefined` DB dinormalisasi sebelum kirim.
- Foto: jpg/jpeg/png/heic/heif/webp → dikonversi ke JPEG terkompresi (maks 1200px, ≤2MB) via
  `shared/lib/image.ts`; cocok dengan limit body BE 5mb.
- Riwayat self-order milik sesi `(nama, meja)`: nama beda di meja sama = pelanggan baru (riwayat lama dibuang);
  tombol Selesai membersihkan HP untuk pelanggan berikutnya.
- Auth: token basi dibuang otomatis (anti 403 peran-menyesatkan); refresh menunggu hydrate;
  polling order basi berhenti (404: 2x, network: 5x) + polling jeda saat tab hidden.

## Struktur Folder

```
apps/web-app/
├── public/                         # aset statis (favicon)
├── index.html
├── package.json                    # + recharts, heic2any (lazy chunk)
├── vite.config.ts
├── .env.example                    # VITE_API_BASE_URL, VITE_PUBLIC_BASE_URL
└── src/
    ├── main.tsx                    # entry React
    ├── App.tsx                     # router + RequireAuth (isHydrating) + legacy redirect
    ├── index.css                   # Tailwind + token warna/font
    ├── mock/                       # seed fallback + state BE-first
    │   ├── data.ts                 # seed lokal (tanpa password; hanya fallback offline)
    │   └── store.tsx               # CafeProvider + useCafe() + helper storage sesi
    ├── lib/
    │   ├── api.ts                  # REST client (Bearer+cookie, refresh, error jujur)
    │   ├── stream.ts               # SSE: subscribe ?token/?qrToken + 7 tipe event realtime
    │   ├── sound.ts                # beep Web Audio (order ±3,5 dtk, simpan ±1 dtk) + notif browser
    │   └── printer.ts              # ESC/POS 58mm + Web Bluetooth/USB real (LAN simulasi)
    ├── shared/                     # dipakai ketiga area
    │   ├── types/index.ts          # tipe domain + BusinessTheme/THEME_PRESETS/normalizeTheme
    │   ├── lib/format.ts           # formatRupiah, uid, formatTime
    │   ├── lib/sales.ts            # agregasi bucket omset (sumber tunggal grafik)
    │   ├── lib/image.ts            # proses upload gambar (HEIC→JPEG, resize, kompres)
    │   ├── lib/qr.ts               # URL self-order untuk QR meja
    │   └── components/
    │       ├── ui.tsx              # Button, Field, TextInput, Badge
    │       └── icons.tsx
    └── features/                   # modul per area aplikasi
        ├── auth/
        │   ├── LoginPage.tsx
        │   └── RequireAuth.tsx
        ├── self-order/             # pelanggan (mobile, bertema)
        │   ├── SelfOrderApp.tsx    # + layar Riwayat per sesi
        │   ├── screens/            # MenuScreen, CartScreen, PaymentScreen, StatusScreen
        │   └── components/         # ItemSheet, BottomNav
        ├── pos/                    # kasir / barista (desktop)
        │   ├── PosLayout.tsx
        │   ├── components/         # PosHeader, ReceiptModal
        │   └── pages/
        │       ├── OrdersPage.tsx
        │       ├── CatalogPage.tsx
        │       ├── InventoryPage.tsx
        │       ├── ManualOrderPage.tsx
        │       └── PosSettingsPage.tsx
        └── owner/                  # analytics & manajemen
            ├── OwnerLayout.tsx     # refresh terpusat + SSE semua area owner
            ├── components/
            │   └── OwnerSidebar.tsx    # Dashboard, Sales, Menu, Tables, Staff, Settings
            └── pages/
                ├── DashboardPage.tsx
                ├── StaffPage.tsx
                ├── TablesPage.tsx
                ├── menu/
                │   ├── MenuCatalogPage.tsx
                │   ├── MenuCategoriesPage.tsx
                │   └── MenuVariantsPage.tsx
                ├── sales/
                │   ├── SalesHistoryPage.tsx
                │   ├── SalesOmsetPage.tsx
                │   └── SalesPerformancePage.tsx
                └── settings/
                    ├── CafeSettingsPage.tsx  # tab Profil + Tema & Tampilan
                    ├── ThemeSettingsPage.tsx # (di-render di dalam tab Tema)
                    ├── ProfileSettingsPage.tsx
                    ├── TaxSettingsPage.tsx
                    └── PaymentSettingsPage.tsx
```
