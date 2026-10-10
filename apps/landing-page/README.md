# Oxcribe Landing Page

Website marketing publik Oxcribe: gerbang dua produk (POS kafe + jasa website) dan pintu
masuk prospek via form Hubungi Sales. Murni informatif — **tidak menyentuh data operasional
tenant mana pun**, kecuali daftar paket dan konten CMS yang memang publik.

- Dev server: `http://localhost:5174` (`npm run dev`)
- Tanpa login. Tanpa build khusus (`npm run build` standar Vite).

## Rute (`src/App.tsx`)

| Path              | Halaman         | Sumber konten                                  |
| ----------------- | --------------- | ---------------------------------------------- |
| `/`               | Home            | CMS `home` (badge, judul, 2 kartu produk, strip CTA, FAQ) + fallback statis |
| `/pos-kafe`       | Landing POS     | Tabel paket dari `GET /api/public/plans` + CMS umum |
| `/jasa-website`   | Jasa Website    | CMS `services` (layanan + tahap alur kerja)    |
| `/hubungi-sales`  | Form prospek    | `POST /api/public/leads` → ditinjau di Platform Admin |

## API publik yang dipakai (`src/lib/api.ts`)

| Method | Endpoint                    | Kegunaan                                   |
| ------ | --------------------------- | ------------------------------------------ |
| GET    | `/api/public/plans`         | Tabel harga Starter/Pro/Enterprise (sumber tunggal — selalu konsisten dengan paket aktif) |
| GET    | `/api/public/landing-content` | Section CMS yang published (hero/features/faq/cta/contact/services/home) |
| POST   | `/api/public/leads`         | Simpan lead: nama bisnis, owner, email, HP, paket diminati, kebutuhan, pesan |

Harga/fitur paket **tidak** di-hardcode — selalu dari `/api/public/plans`. Teks hero, fitur,
FAQ, kontak dari `landing-content` (diubah tim non-teknis via Platform Admin → Konten,
tanpa deploy ulang). Bila API mati, halaman memakai fallback statis terakhir yang
tersimpan (landing tetap bisa dibuka).

## CMS section (`key` → isi)

| Key        | Isi                                      |
| ---------- | ---------------------------------------- |
| `hero`     | badge, judul, subjudul                   |
| `features` | heading + kartu (ikon Material Symbol, tag, judul, deskripsi) |
| `faq`      | heading + daftar tanya-jawab             |
| `cta`      | kartu ajakan + catatan kecil             |
| `contact`  | WhatsApp sales + jam online              |
| `services` | badge/heading + kartu layanan + tahap alur kerja |
| `home`     | badge/judul/subjudul + 2 kartu produk + strip CTA + FAQ |

## Alur prospek → tenant ( peran landing)

1. Prospek bandingkan paket → isi **Hubungi Sales** (berlaku untuk ketiga paket —
   tidak ada signup instan).
2. Lead masuk → tim sales menindaklanjuti → Platform Admin onboarding manual
   (Tenant Baru → langsung `active`).
3. Owner terima kredensial → login di web-app (`:5173/login`).

## Stack & env

- **React 19 + Vite + React Router 7 + Tailwind 4** + Inter + `material-symbols`.
- Env (lihat `.env.example`):
  - `VITE_API_BASE_URL` — backend (default `http://localhost:4000`)
  - `VITE_PUBLIC_BASE_URL` — dipakai untuk link Self-Order di konten/QR

```bash
cd apps/landing-page
npm install
npm run dev      # :5174
npm run build    # tsc + vite (wajib lolos sebelum commit)
```
