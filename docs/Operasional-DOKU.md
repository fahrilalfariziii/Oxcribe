# Runbook Operasional DOKU (Sub-Account V2 + SNAP Direct API)

Dokumen ini adalah panduan operasional dana untuk tim Oxcribe. Isinya digabung dari
[dokumentasi resmi DOKU](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route)
dan **aliran yang sudah terverifikasi live di sandbox** (inquiry, payout, settlement,
split rule — semua response code di bawah benar-benar diobservasi, bukan karangan).

> **Aturan #1:** dana `DOKU_MERCHANT_PENDING_IDR` **tidak bisa** dicairkan/diutak-atik —
> ia pindah sendiri ke `DOKU_MERCHANT_IDR` saat settlement. Semua payout hanya dari IDR.
> **Aturan #2:** jangan `TRUNCATE`/seed-ulang environment yang sudah transaksi ke DOKU.

## 1. Peta akun (satu sub-account per tenant)

| Akun                    | Kode                      | Bisa dicairkan? | Isi dari |
| ----------------------- | ------------------------- | --------------- | -------- |
| IDR                     | `DOKU_MERCHANT_IDR`       | **Ya**          | Settlement + top-up BRI VA |
| Pending IDR             | `DOKU_MERCHANT_PENDING_IDR` | **Tidak** (system-managed) | Charge Checkout/Direct API (QRIS/VA) |
| Poin                    | `DOKU_MERCHANT_POINT`     | Tidak (non-tunai) | Top-up poin / debit |
| System Point (profil merchant saja) | `DOKU_SYSTEM_POINT` | Tidak | Saldo negatif = total poin beredar (normal!) |

Setiap akun punya `available` (bisa dipakai) dan `reserved` (ditahan). **Reserved ≠ Pending**:
reserved adalah hold *di dalam* satu akun, Pending adalah *akun terpisah*.

```
Bayar QRIS/VA Direct          Top-up BRI VA bawaan
      │                                │
      ▼                                ▼
DOKU_MERCHANT_PENDING_IDR      DOKU_MERCHANT_IDR (real-time,
(held sampai settlement)        langsung bisa dicairkan)
      │ settlement H+1
      │ (potong fee PG → terapkan split rule ke NET)
      ▼
DOKU_MERCHANT_IDR ──Transfer Inquiry + Payment (BI_FAST)──▶ bank owner
```

## 2. Setup awal per tenant

### 2.1. Kredensial (`.env` backend, mode Sandbox)

```
DOKU_CLIENT_ID, DOKU_SECRET_KEY, DOKU_PRIVATE_KEY (\n literal),
DOKU_MERCHANT_ID, DOKU_TERMINAL_ID, DOKU_POSTAL_CODE=10110,
DOKU_IS_PRODUCTION=false
DOKU_PARTNER_SERVICE_ID (+ per-bank bila beda) + DOKU_VA_*_CUSTOMER_PREFIX
DOKU_NOTIFICATION_URL (ngrok saat lokal), DOKU_MAIN_IDR_ACCOUNT
```

Tanpa kredensial: order tetap tercatat tapi **tanpa** QR/VA (frontend menampilkan retry
yang jujur — bukan error palsu).

### 2.2. Daftarkan sub-account (superadmin, idempoten)

```bash
PTOKEN="<token superadmin>"
curl -s -X POST http://localhost:4000/api/platform/tenants/1/doku-subaccount/register \
  -H "Authorization: Bearer $PTOKEN" -H "Content-Type: application/json" -d '{}'
# -> { status: ok, profileId: "SAC-xxxx-...", subAccountStatus: "active" }
```

Tersimpan: `dokuProfileId` + `dokuSubAccounts[]` (POINT, IDR `2010…`, Pending `2030…`) +
VA BRI statis. Batasan DOKU: email ≤ 25 karakter, nama hanya huruf/angka/spasi/`.'-`
(maks 100) — selain itu `4000601`.

### 2.3. Nomor VA BRI bawaan

```
VA = 1392495 + <nomor akun IDR>   (contoh: 2010195754 → 13924952010195754)
```

Permanen, bisa dipakai ulang. Nama tampil di m-banking: `Merchant Balance + [Nama Tenant]`.

## 3. Top-up sandbox (simulator)

Di sandbox tidak ada bank asli — bayar VA lewat simulator DOKU:

1. Buka `https://sandbox.doku.com/integration/simulator/` → pilih **BRI Virtual Account**.
2. Masukkan VA dari §2.3 → **Inquiry** → cek nama → confirm bayar.
3. Saldo IDR bertambah **real-time** + webhook top-up ke callback.

**Jebakan #1 (paling sering):** memakai nomor akun **Pending (`2030…`)** → simulator menjawab
`Invalid Bill/Virtual Account` dan terlihat "rusak". Selalu pakai akun **IDR (`2010…`)**.

## 4. Settlement & split rule (otomatis H+1, bukan API)

- Charge QRIS/VA Direct mendarat di **Pending**, belum ter-split — penjual cek saldo pun
  bagiannya belum terlihat. Itu normal.
- Saat settlement (hari kerja, kisaran 12:00–14:00 WIB, H+1 tergantung channel):
  1. DOKU potong fee PG,
  2. split rule dihitung dari **NET (setelah fee), bukan gross**,
  3. tiap tujuan terima `SPLIT_TRANSACTION` ke **IDR** — baru bisa dicairkan.
- Di sandbox, settlement **tidak** terjadi same-day (terobservasi: dana Pending mengendap).
  Lihat tanggal settlement per transaksi di Dashboard DOKU → Reports → Reconciled Transactions.

### Membuat split rule (superadmin)

```bash
curl -s -X POST http://localhost:4000/api/platform/tenants/1/doku-subaccount/split-rule \
  -H "Authorization: Bearer $PTOKEN" -H "Content-Type: application/json" \
  -d '{"rules":[{"type":"PERCENTAGE","value":5,"accountNumber":"2010195754"}]}'
# -> { status: ok, splitRuleId: "split_rule-..." } (tersimpan + audit doku_split_rule_created)
```

Aturan main:
- `type`: `PERCENTAGE` (persen dari net) atau `FLAT` (+ `currency: IDR`).
- `accountNumber`: nomor akun DOKU tujuan fee. **Untuk uji, pakai akun IDR tenant sendiri**
  (risiko nol). Untuk produksi, pakai akun fee platform — **jangan asal nomor**.
- **Dua silent failure DOKU** (API tidak error!): `split_rule_id` invalid → dana masuk tanpa
  split; `account.id` invalid → transaksi nyangkut, urus manual via ops DOKU. Backend
  menangkalnya dengan validasi `balance-inquiry` sebelum routing charge
  (`resolveValidatedTenantRoute`, cache 1 jam).
- Charge yang membawa rule: otomatis — setiap charge tenant ber-`splitRuleId` menyertakan
  `additionalInfo.account = { id: profileId, split_rule_id }`.

## 5. Verifikasi rekening settlement (superadmin, tanpa gerak dana)

```bash
curl -s -X PATCH http://localhost:4000/api/platform/tenants/1/settlement \
  -H "Authorization: Bearer $PTOKEN" -H "Content-Type: application/json" \
  -d '{"bankCode":"CENAIDJA","bankAccount":"92482374832742","bankName":"VIGINA VANARIKA"}'
# -> { settlement: {..., status: "VERIFIED" | "MISMATCH" | "UNVERIFIED" }, dokuBeneficiaryName }
```

- Backend inquiry Rp10.000 (validasi nama saja) lalu bandingkan nama DOKU vs `bankName`.
- `VERIFIED` = cocok; `MISMATCH` = rekening milik orang lain (perilaku benar — koreksi
  `bankName`, jangan abaikan); `UNVERIFIED` = inquiry gagal karena saldo 0 — verifikasi
  ulang setelah top-up. Kode bank = SWIFT/BIC (`CENAIDJA/BRINIDJA/BNINIDJA/BMRIIDJA`).

## 6. Payout / pencairan (superadmin)

Hanya dari **IDR**. Endpoint `POST /api/platform/tenants/:id/doku-subaccount/transfer`
(superadmin; tanpa dry-run — langsung eksekusi):

```bash
curl -s -X POST http://localhost:4000/api/platform/tenants/1/doku-subaccount/transfer \
  -H "Authorization: Bearer $PTOKEN" -H "Content-Type: application/json" \
  -d '{"amount":10000,"beneficiaryBankCode":"CENAIDJA","beneficiaryAccountNumber":"92482374832742"}'
```

Backend menjalankan berurutan (terverifikasi live: inquiry `2004200` → payment `2004300`,
ref `DK…`, audit `doku_transfer_initiated`, saldo IDR berkurang):

1. **Transfer Inquiry** — validasi tujuan → `referenceNo` + `beneficiaryAccountName` resmi.
2. **Transfer Payment** — wajib echo kembali: `partnerReferenceNo`, `referenceNo`, `type`,
   `channel` (default `BI_FAST`), `fromAccount`, `beneficiaryBankCode/AccountNumber/**AccountName**`,
   `amount`. Hanya `referenceNo` saja **ditolak** (`4004302`).
3. `fromAccount` default = akun **IDR** (bukan `accounts[0]` yang isinya POINT).
4. Di UI admin: Tab Pembayaran tenant → input nominal → **Cairkan ke rekening**.
5. Terobservasi: payout Rp10.000 mengurangi IDR Rp12.500 (≈ Rp2.500 fee BI_FAST) — sisakan
   margin saat mencairkan habis.

**Dana historis pra-sub-account** (campur di akun utama) pakai endpoint terpisah
`.../transfer-from-main` dengan `dryRun=true` (cek saja) atau `confirm=true` + `tenantNote`
wajib (audit `doku_main_payout`).

## 7. Webhook (2 URL, jangan tertukar)

| URL | Event | Daftar |
| --- | ----- | ------ |
| `/api/public/doku/notification` | Payment (QRIS/VA lunas/gagal) | Otomatis di kode |
| `/api/public/doku/sub-account/notification` | Register/top-up/transfer/debit | Diregistrasi **terpisah** di setup merchant |

Keduanya verifikasi `X-SIGNATURE` simetris, fail-closed (signature salah = tolak + audit),
dan wajib `200 {"responseCode":"2000000"}`. Tanpa URL publik (ngrok), pakai polling
`GET /api/public/orders/by-client/:clientOrderId/status` (auto-sync paid).

## 8. Tabel error lapangan (terobservasi)

| Kode / Gejala | Arti | Aksi |
| ------------- | ---- | ---- |
| `4034202/4034215` inquiry/transfer | Saldo sumber kurang (atau salah akun POINT) | Cek `balance-inquiry`; top-up dulu; pastikan `fromAccount` IDR |
| `4004302 Invalid Mandatory Field amount/name` | `transfer-payment` tidak echo detail | Lihat §6 — lengkapi field wajib |
| `4000601` register | Nama/email format ditolak DOKU | Sanitasi nama; email ≤ 25 char |
| `4032715` create VA | Prefix customerNo salah per bank | Samakan prefix di `.env` dengan tabel dashboard DOKU |
| Simulator `Invalid Bill` | VA dari akun Pending | Pakai VA dari akun IDR (§2.3) |
| Settlement `UNVERIFIED` | Inquiry gagal (saldo 0) | Top-up lalu verifikasi ulang |
| Settlement `MISMATCH` | Nama ≠ pemilik rekening | Koreksi `bankName`, bukan bypass |
| Charge sukses tapi dana "hilang" | `account.id`/`split_rule_id` invalid (silent!) | Cek routing tervalidasi + audit; hubungi ops DOKU |

## 9. Monitoring

- `GET /api/platform/tenants/:id/doku-subaccount` — status + saldo live + splitRuleId.
- `POST /sub-account/v2.0/transaction-history-list` (via API DOKU) — rekonsiliasi;
  ingat `balance = Σ baris status != VOID`.
- Dashboard DOKU → Reports → Reconciled Transactions — tanggal settlement per transaksi.
- Audit log backend: `doku_subaccount_registered`, `doku_split_rule_created`,
  `doku_settlement_verified`, `doku_transfer_initiated`, `doku_main_payout`,
  `doku_subaccount_event`.
