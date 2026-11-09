# Operasional pembayaran DOKU Oxcribe

Panduan ini menjelaskan alur aplikasi saat ini. Self-Order menerima **tunai dan QRIS**. QRIS diterima terpusat pada akun merchant DOKU; setiap tenant mempunyai ledger internal Oxcribe. POS tetap mendukung pencatatan pembayaran manual, termasuk transfer bank. Pencatatan POS manual tidak menambah saldo wallet platform.

Aktivasi QRIS, tarif dan waktu settlement merchant harus dikonfirmasi melalui kontrak serta laporan DOKU yang berlaku. Perubahan kode dan pengujian lokal bukan bukti transaksi produksi. Lihat [Produksi-Pembayaran.md](Produksi-Pembayaran.md) untuk persiapan deployment, backup dan verifikasi live.

## Pembayaran dan saldo

Percobaan QRIS disimpan sebelum request gateway. Referensi pembayaran digunakan untuk webhook, polling dan rekonsiliasi. Request ulang untuk percobaan yang belum jelas hasilnya tidak boleh dianggap sebagai izin menerbitkan tagihan baru. Timeout atau pembayaran terlambat perlu ditelusuri melalui referensi yang tersimpan.

Webhook pembayaran memakai `POST /api/public/doku/notification`; signature wajib valid. Inbox notifikasi dan worker menangani retry, sedangkan polling status memakai transisi pembayaran yang sama. Order paid dan kredit ledger pending dicatat atomik serta idempoten.

- `pendingBalance`: estimasi pendapatan bersih, belum tersedia untuk payout.
- `availableBalance`: pendapatan yang sudah direkonsiliasi terhadap settlement nyata.
- `reservedBalance`: saldo yang ditahan untuk tiket payout pending atau processing.

Jam server, restart, atau asumsi H+1 tidak memindahkan pending ke available. Scheduler hanya membuat tiket pencairan sesuai preferensi merchant dan tanggal Asia/Jakarta, paling banyak satu tiket terjadwal per bisnis per tanggal.

## Rekonsiliasi settlement

Superadmin mencocokkan pembayaran dengan statement settlement merchant dan biaya gateway aktual. Daftar kandidat berasal dari `GET /api/platform/payouts/unsettled`, dengan filter opsional `businessId`. Pembayaran harus paid, QRIS DOKU, Self-Order, belum settled dan tidak memiliki penanda review.

`POST /api/platform/payouts/settlements` (superadmin):

```json
{
  "reference": "STATEMENT-MERCHANT-2026-11-06",
  "payments": [{ "paymentId": 123, "gatewayFee": 700 }]
}
```

Nominal dalam rupiah utuh. Setiap pembayaran memerlukan biaya aktual, termasuk nilai nol bila memang sesuai statement. Satu batch atomik: sistem mengurangi estimasi pending dan menambah net aktual ke available, menyimpan referensi, biaya aktual, waktu settlement dan ledger. Pembayaran yang sama tidak dapat di-settle dua kali. Ketidakcocokan ledger atau saldo menyebabkan penolakan dan perlu investigasi.

## Rekening merchant

Owner mengajukan rekening lewat `POST /api/wallet/bank-account`:

```json
{ "bankCode": "014", "bankAccount": "1234567890", "accountName": "NAMA PEMILIK" }
```

Pengajuan selalu berstatus belum terverifikasi; perubahan rekening menghapus verifikasi sebelumnya. Tidak ada hasil inquiry simulasi yang dianggap valid. Admin melihat pengajuan melalui `GET /api/platform/wallets` dan memeriksa bukti kepemilikan rekening secara manual.

`POST /api/platform/wallets/:businessId/verify-bank` (superadmin):

```json
{ "accountName": "NAMA PEMILIK", "evidence": "Referensi dokumen dan hasil pemeriksaan rekening" }
```

Nama harus cocok dengan pengajuan merchant. Bukti dan identitas admin disimpan dalam audit transaksi verifikasi. Payout memerlukan rekening terverifikasi.

## Payout manual

Owner membaca saldo/ledger melalui `GET /api/wallet`, mengatur preferensi tiket terjadwal melalui `PUT /api/wallet/settings`, dan mengajukan payout melalui `POST /api/wallet/payout` dengan `{ "amount": 50000 }`. Jadwal tersebut membuat tiket; admin tetap melakukan transfer manual. Penarikan harus memenuhi minimum dan menyisakan hold minimum merchant. Nominal ditahan dari available ke reserved saat tiket dibuat.

| Endpoint platform | Izin | Tindakan |
| --- | --- | --- |
| `GET /api/platform/payouts` | superadmin/support | Daftar tiket, rekening snapshot dan rekening pengajuan terbaru |
| `POST /api/platform/payouts/:id/process` | superadmin | pending ke processing |
| `POST /api/platform/payouts/:id/complete` | superadmin | processing ke completed; wajib `bankRefNumber` dan `proofImageUrl` URL |
| `POST /api/platform/payouts/:id/reject` | superadmin | Tolak pending/processing dengan `reason`; kembalikan dana tepat sekali |

Admin memastikan transfer bank benar-benar selesai sebelum menandai completed. Penolakan tiket yang sudah ditransfer dapat menggandakan kewajiban merchant; periksa bukti bank terlebih dahulu. Tiket rejected tidak dapat diselesaikan. Support dapat membaca data keuangan tetapi tidak dapat menulis settlement, verifikasi, refund, payout, tarif platform atau paket.

## Refund manual

Refund dicatat setelah operator menangani pengembalian dana di luar aplikasi. Endpoint ini **tidak mengirim uang**:

`POST /api/platform/payments/:id/refund` (superadmin):

```json
{
  "amount": 10000,
  "reference": "REFUND-BANK-123",
  "proofImageUrl": "https://storage.example/refund-123.png",
  "reason": "Koreksi transaksi pelanggan"
}
```

Sistem mengurangi pending sebelum settlement atau available setelah settlement, menambah total refund pembayaran dan menyimpan ledger serta bukti. Referensi yang sama tidak dicatat ulang. Refund tidak boleh melampaui nominal pembayaran, sisa pendapatan bersih merchant atau saldo tersedia pada bucket tersebut. Pengembalian gross yang membutuhkan pendanaan biaya platform/gateway, atau saldo merchant yang sudah ditarik, harus direkonsiliasi secara terpisah sebelum dicatat.

## Riwayat dan operasi

- Migrasi historis tidak boleh dihapus atau ditulis ulang. Migrasi baru mempertahankan jejak eksperimen lama sebagai arsip.
- Saldo dan transaksi legacy harus diperiksa eksplisit terhadap laporan gateway serta mutasi bank. Jangan menganggap estimasi pending lama masih merupakan dana belum settled; penanda review memblokir settlement biasa.
- Jangan seed database produksi atau database berisi transaksi nyata. Jangan reset tabel, sequence maupun volume database untuk memperbaiki status pembayaran.
- Tidak ada pembuatan subaccount, split rule, VA Self-Order maupun transfer DOKU otomatis dalam alur ini. Endpoint eksperimen tersebut sudah dihapus.
- Simpan statement, bukti bank dan referensi refund/payout agar setiap perubahan dana dapat ditelusuri. Pantau notifikasi gagal, pembayaran review, saldo negatif, payout processing lama dan ketidaksesuaian ledger.
