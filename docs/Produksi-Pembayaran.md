# Peluncuran pembayaran Oxcribe

Target: merchant DOKU personal terpusat, Self-Order tunai/QRIS, ledger per kafe, rekonsiliasi settlement dan pencairan bank manual. Tidak ada VA Self-Order, transfer bank otomatis atau pemisahan dana gateway per tenant.

## Sebelum deployment

1. Pastikan produk QRIS produksi aktif, merchant terverifikasi, rekening settlement benar, serta pola penerimaan pembayaran kafe sesuai layanan yang diaktifkan pada akun. Catat jadwal settlement dan biaya merchant dari DOKU, bukan dari estimasi kode.
2. Sediakan PostgreSQL, backend Node 22, HTTPS untuk API/web/admin, serta domain frontend dalam CORS_ORIGIN. Jangan memasukkan URL database atau private key ke variabel VITE_.
3. Inject konfigurasi dari secret manager hosting: NODE_ENV=production, DATABASE_URL, JWT_SECRET acak minimal 32 karakter, CORS_ORIGIN, PUBLIC_BASE_URL, DOKU_NOTIFICATION_URL, DOKU_IS_PRODUCTION=true, DOKU_CLIENT_ID, DOKU_SECRET_KEY, DOKU_PRIVATE_KEY, DOKU_MERCHANT_ID dan DOKU_TERMINAL_ID. Path notification wajib /api/public/doku/notification. Startup memvalidasi kelengkapan dan HTTPS. Nilai rahasia tidak disimpan dalam repo.
4. Daftarkan callback HTTPS tersebut pada dashboard DOKU. Mengisi DOKU_NOTIFICATION_URL saja tidak mendaftarkan callback ke DOKU. Uji signature dan respons acknowledgment dengan payload QRIS yang benar.
5. Jalankan instalasi dari lockfile, generate client, seluruh tes dan build. Workflow .github/workflows/verify.yml menjalankan tes PostgreSQL disposable dan build backend, web-app, admin, serta landing.

```powershell
npm ci
npm test
npm run build:backend
npm run build:webapp
npm run build:admin
npm run build:landing
```

Untuk generate/validate lokal tanpa membaca berkas konfigurasi proyek, gunakan `node backend/scripts/prisma-isolated.cjs generate` atau `validate`. Skrip menyalin schema ke TEMP dan memakai dependency lokal; tidak menghubungi database. Tes keuangan nyata membutuhkan PAYMENT_TEST_DATABASE_URL ke database lokal bernama payment_test; jangan menggunakan database produksi untuk tes.

## Migrasi dan data lama

Backup sebelum menerapkan migrasi. Gunakan `npm run prisma:deploy --workspace=servopay-backend` di lingkungan deployment yang sudah diberi DATABASE_URL. Jangan memakai seed atau migrate dev di produksi. Migrasi disiapkan dalam repo; pelaksanaan pada database aktif merupakan langkah deployment.

Migrasi 20261106000000_payment_production membuat tabel wallet yang belum tercakup migrasi historis, menambahkan charge attempts/inbox, metadata rekonsiliasi/refund, kunci idempotensi ledger dan saldo reserved. Tiket pending/processing lama diinisialisasi sebagai reserved karena available sudah dipotong oleh implementasi lama. Verifikasi rekening lama direset karena implementasi sebelumnya dapat menghasilkan verifikasi simulasi.

Konfigurasi eksperimen lama diarsipkan ke audit log sebelum kolomnya dihapus. Riwayat migrasi terdahulu dipertahankan. Pembayaran DOKU paid lama diberi reviewReason; migrasi tidak menebak apakah saldo lama pernah diaktifkan atau dikreditkan ganda. Rekonsiliasikan saldo awal dengan laporan DOKU, rekening bank, histori ledger dan payout sebelum membuka pencairan. Entri yang ditandai review tidak dapat memakai settlement normal untuk mengambil saldo pending transaksi baru.

Rollback aplikasi setelah migrasi membutuhkan versi yang memahami skema baru; kode lama yang membaca kolom eksperimen yang sudah dihapus tidak kompatibel. Gunakan maintenance window untuk backup, migrasi, deployment backend/frontend yang sesuai, dan pemeriksaan penerimaan. Pulihkan snapshot database bila rollback penuh diperlukan; evaluasi transaksi yang terjadi setelah snapshot terlebih dahulu.

## Uji penerimaan merchant

- Buat order tunai: tidak ada charge DOKU dan tidak ada pendapatan wallet platform.
- Bayar QRIS nominal kecil: cocokkan referensi, nominal rupiah dan IDR; order paid dan satu pendapatan pending wallet harus tercatat bersama.
- Kirim ulang webhook dan buka dua tab pelanggan: jumlah kredit tetap satu.
- Tutup browser setelah QR dibuat: worker backend tetap memeriksa pembayaran.
- Putuskan koneksi saat charge: referensi attempt harus tersimpan dan tidak otomatis diganti oleh charge baru. Kasus ambigu masuk antrean review.
- Batalkan order lalu terima konfirmasi pembayaran terlambat: pertahankan order batal, tandai rekonsiliasi, jangan diam-diam mengkredit atau kehilangan referensi pembayaran.
- Restart backend: pending tidak berubah available hanya karena restart.
- Setelah settlement nyata, cocokkan transaksi dan biaya aktual, masukkan referensi laporan, lalu pastikan hanya transaksi terpilih menjadi available.
- Owner ajukan rekening; superadmin verifikasi manual dengan bukti. Owner mengubah rekening harus menghapus status verifikasi.
- Ajukan pencairan kecil: available berkurang dan reserved bertambah. Admin mulai proses, transfer via bank, lalu simpan referensi dan URL bukti HTTPS. Completed mengurangi reserved. Penolakan hanya mengembalikan saldo sekali.
- Login support: semua mutasi settlement, rekening, refund dan payout ditolak 403.

## Refund dan kasus review

GET /api/platform/payments/review menampilkan pembayaran yang butuh pemeriksaan dan callback yang belum bisa diproses. Unknown reference tidak dibuang; inbox menyimpan error dan jadwal retry. Untuk penelusuran, gunakan payment ID, partnerReferenceNo, orderNumber, bukti dashboard DOKU dan mutasi bank. Jangan menghapus attempt/inbox untuk menyembunyikan masalah.

POST /api/platform/payments/:id/refund mencatat pengembalian yang sudah dilakukan manual, beserta nominal, referensi, bukti dan alasan. Endpoint ini tidak mengirim uang. Saldo merchant dibalik atomik, terbatas pada pendapatan bersih yang masih tersedia. Pengembalian yang melebihi saldo bersih, pembayaran terlambat yang belum diakui sebagai pendapatan, atau saldo historis tidak konsisten memerlukan rekonsiliasi keuangan terpisah; jangan menyelesaikannya dengan SQL ad hoc tanpa backup dan verifikasi saldo akhir. Tidak ada endpoint untuk menghapus reviewReason secara sembarang.

## Backup dan pemulihan

Gunakan snapshot terjadwal dari provider dan dump harian terenkripsi ke penyimpanan terpisah. Contoh berikut memakai variabel PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD yang diinject oleh secret manager; jangan menaruh password pada argumen command atau log.

```powershell
pg_dump --format=custom --file=oxcribe-backup.dump
pg_restore --list oxcribe-backup.dump
```

Lakukan latihan restore pada database BARU dengan credential khusus restore. Verifikasi jumlah order/payment, saldo pending/available/reserved, jumlah ledger per payment, dan tiket payout. Catat waktu backup terakhir, durasi restore dan transaksi yang harus direkonsiliasi setelah pemulihan. Retensi, target kehilangan data dan target waktu pemulihan ditentukan pemilik operasional; keberadaan skrip bukan bukti restore berhasil.

## Monitoring

- /health memeriksa proses; /ready harus 200 jika database dapat diakses, 503 jika tidak tersedia.
- Pasang monitor HTTPS dari hosting untuk /ready dan alert downtime ke kanal operasional yang dipilih pemilik.
- Pantau error [payment worker] dan [scheduler], callback pending berulang, reviewReason, order pending terlalu lama, dan payout processing tertunda.
- Rekonsiliasi harian total diterima gateway, biaya aktual, settlement bank dan kewajiban wallet per kafe. Selisih harus memiliki penjelasan serta bukti; jangan mengaktifkan saldo hanya berdasarkan usia.
- Log tidak boleh memuat token Authorization, private key, secret DOKU atau password database. Batasi akses admin dan arsip bukti transfer.

## Batas hasil implementasi

Tes otomatis memakai provider tiruan dan PostgreSQL disposable. Tidak ada klaim bahwa callback merchant produksi, tarif aktual, settlement bank, deployment hosting, atau backup/restore infrastruktur nyata sudah diverifikasi. Langkah-langkah tersebut harus menghasilkan bukti di lingkungan yang dituju sebelum membuka transaksi produksi.
