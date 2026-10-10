# Oxcribe Platform Admin

Dashboard internal untuk tim Oxcribe mengelola seluruh tenant (kafe) yang berlangganan.
**Bukan** untuk owner/kasir kafe — mereka memakai `apps/web-app` dengan sesi terpisah.

- Dev server: `http://localhost:5175` (`npm run dev`)
- Login: `http://localhost:5175/platform/login` (redirect otomatis bila belum login)
- Semua data lewat `GET/POST/PATCH /api/platform/*` (lihat `backend/README.md` §5 Platform Admin)

## Sesi terisolasi (wajib paham)

| Aspek   | Platform Admin            | Tenant (kasir/owner)        |
| ------- | ------------------------- | --------------------------- |
| Login   | `POST /api/platform/auth/login` | `POST /api/auth/login` |
| Token   | JWT `scope: platform`     | JWT tenant                  |
| Cookie  | `platform_token`          | `token`                     |
| Storage | `servopay_platform_token` | `servopay_token`            |

Token tenant **ditolak** di semua endpoint `/api/platform/*` dan sebaliknya. Token basi
(401) otomatis dibuang dari storage agar tidak mengulang error.

| Login dev (hasil seed) | Password    | Batasan                                  |
| ---------------------- | ----------- | ---------------------------------------- |
| `admin@oxcribe.id` (superadmin) | `Admin123!` | Penuh, termasuk payout & reset password |
| `support@oxcribe.id` (support)  | `Support123!` | Read-only billing; tidak bisa payout/reset password |

> **Seed ≠ database aktif** (lihat root `README.md` §5): email di atas berasal dari
> `backend/prisma/seed.ts`. Bila database dev masih berisi `admin@ordria.id` lama,
> login pakai email lama atau migrasikan barisnya manual (backup dulu).

## Struktur rute (`src/App.tsx`)

```
/platform/login            publik — email+password (+ ?next=…)
/platform/                 butuh login (RequirePlatform)
  tenants                  daftar + filter + onboarding (Tenant Baru)
  tenants/:id              Detail Tenant (4 tab: Overview/Konfigurasi/Pembayaran/Audit)
  users                    Pengguna: tab Internal (admin) | Merchant (staff tenant)
  plans                    3 paket + edit flags/limits (langsung memengaruhi gating!)
  invoices                 billing manual + export CSV + tandai lunas
  leads                    tinjau lead Hubungi Sales (new/contacted/onboarded/rejected)
  content                  CMS landing (hero/features/faq/cta/contact/services/home)
  analytics                tenant per paket, baru/bulan, MRR
  audit                    semua audit log + filter
```

## Halaman per halaman

### Tenant (`TenantsPage`)
Tabel agregat (bukan detail struk): bisnis, paket, status, order 30 hari, email owner.
Filter nama/email/slug + paket + status. Statistik atas: total, aktif, perlu perhatian
(past_due/suspended/canceled), total order 30 hari. Tombol **Tenant Baru** membuka
`TenantCreateSheet` (nama, slug auto-sanitasi, owner + password, paket) → langsung `active`,
tanpa trial → redirect ke detail tenant baru.

### Detail Tenant (`TenantDetailPage` + `pages/tenant/`)
- **Header**: breadcrumb, ID/slug/tanggal gabung, badge status + paket, tombol Kembali.
- **Statistik**: order 30 hari, omzet 30 hari, staff aktif, meja aktif.
- **Tab Overview**: info bisnis, staff (+role), kartu Langganan (ubah paket/status —
  downgrade tidak menghapus histori), **Danger Zone** (reset password owner, superadmin,
  konfirmasi modal).
- **Tab Konfigurasi**: override fitur per grup (Akses Modul / Analitik & Laporan /
  Tema / Pajak & Biaya / Lainnya) via switch (buat/ubah) + hapus (kembali ke paket);
  section platform fee (%/flat + simulasi + keputusan bearer owner, read-only di sini).
- **Tab Pembayaran & Integrasi**: status sub-account DOKU (profileId, settlement +
  status VERIFIED/MISMATCH/UNVERIFIED), kartu saldo IDR/Pending/Poin, tombol Daftarkan
  (superadmin) & Cairkan (superadmin), detail teknis JSON di accordion (tidak mendominasi).
- **Tab Audit Log**: tabel + pencarian + expand before/after.

### Pengguna (`UsersPage`)
Dua tab read-only (kelola akun tetap lewat endpoint khusus):
- **Internal**: `platform_admins` (nama, email, role superadmin/support, active).
- **Merchant**: staff semua tenant (nama, email, role owner/kasir/barista, tenant terlink,
  active). Filter nama/email + role + ID tenant.

### Paket (`PlansPage`)
3 kartu paket: harga, siklus, jumlah tenant, chips flag. Edit via modal: nama, harga,
siklus, `featureFlags` + `limits` sebagai JSON (dengan toggle per flag yang menulis JSON
otomatis) + aktif. **Simpan langsung memengaruhi feature gating semua tenant paket itu**
dan tercatat di audit (`plan_changed`).

### Invoice (`InvoicesPage`)
Ringkasan (total, Rp belum lunas, count lunas), filter status, tabel + export CSV.
Buat manual (superadmin: ID tenant + jumlah + jatuh tempo). Tandai lunas (superadmin +
catatan opsional, audit `invoice_marked_paid`). Support read-only.

### Leads / Konten / Analitik / Audit
- **Leads**: kartu per lead (bisnis, owner, kontak, paket diminati, pesan) + tombol ubah
  status (audit `lead_status_changed`).
- **Konten**: editor per section (hero/features/faq/cta/contact/services/home) + toggle
  Published + validasi judul wajib + **Simpan & Publish Semua** (landing berubah langsung).
  Section tak dikenal tampil read-only agar tak merusak data.
- **Analitik**: MRR, langganan aktif, bar tenant-per-paket & tenant-baru-per-bulan (CSS murni).
- **Audit**: filter ID tenant + aksi (server-side), tabel + expand JSON before/after.

## Operasi DOKU di UI (ringkas; detail di `docs/Operasional-DOKU.md`)

1. **Daftarkan** sub-account tenant (Tab Pembayaran) → `profileId` + VA BRI statis.
2. **Top-up** via simulator sandbox ke VA `1392495 + <akun IDR>` (masuk IDR real-time).
3. **Verifikasi rekening**: `PATCH .../settlement` (saat ini via curl — belum ada form UI).
4. **Split rule**: `POST .../split-rule` (saat ini via curl — belum ada form UI).
5. **Cairkan**: input nominal → Transfer Inquiry + Payment (`BI_FAST`), tercatat di audit.

## Stack & pola kode

- **React 19 + Vite + React Router 7 + Tailwind 4** + Inter + `material-symbols`
  (jangan tambah library ikon lain; jangan introduksi shadcn — primitives ada di
  `src/components/ui.tsx` dan **wajib** dipakai semua halaman).
- State: `PlatformAuth` context + fetch per halaman; tidak ada store global.
- Setiap halaman: `PageHeader` + `Alert` + `Skeleton` + `Table`/`Card` + empty state.
- Env: `VITE_API_BASE_URL` (default `http://localhost:4000`).

```bash
cd apps/admin
npm install
npm run dev      # :5175
npm run build    # tsc + vite (wajib lolos sebelum commit)
npm run lint     # oxlint
```
