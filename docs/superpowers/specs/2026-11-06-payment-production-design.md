# Pembayaran produksi Oxcribe

Disetujui pengguna: rekomendasi kajian DOKU, dengan Self-Order hanya tunai dan QRIS. Akun DOKU personal memakai penerimaan terpusat; tidak ada sub-account, split rule, VA Self-Order, atau transfer DOKU otomatis. POS mempertahankan pencatatan manual yang ada.

## Alur

Harga authoritative dihitung di server dalam rupiah utuh. Setiap percobaan QRIS mempunyai referensi unik yang tersimpan sebelum request gateway. Checkout ulang tidak membuat charge baru. Webhook diverifikasi, disimpan, lalu diproses idempoten. Polling dan worker menggunakan transisi pembayaran yang sama. Order paid dan pendapatan pending wallet tercatat atomik. Pembayaran manual tidak menambah wallet platform.

Saldo pending merupakan estimasi pendapatan. Hanya rekonsiliasi eksplisit oleh superadmin, dengan referensi settlement dan biaya gateway aktual, yang memindahkan dana transaksi terpilih ke available. Restart/jadwal tidak men-settle otomatis. Payout menahan saldo internal, diproses manual oleh admin, dan harus diselesaikan dengan referensi serta bukti transfer. Penolakan mengembalikan saldo tepat sekali. Refund dicatat per pembayaran dengan bukti dan pembalik ledger; tidak otomatis mengirim dana ke pelanggan.

## Batas dan pilihan

Pendekatan penerimaan terpusat + pencairan manual dipilih karena pengguna menolak fitur corporate. Sub-account dan Kirim DOKU otomatis tidak dipakai. Rekonsiliasi manual berbasis transaksi dipilih daripada asumsi H+1; aktivasi produk, tarif, dan settlement merchant tidak dapat ditebak dari kode. Database aktif dan .env tidak dibaca atau diubah. Migrasi baru dipersiapkan tetapi tidak dijalankan terhadap database aktif. Riwayat migrasi lama dan transaksi historis dipertahankan.

## Kelulusan

Pengiriman webhook ulang/paralel menghasilkan satu kredit. Paid tidak ditimpa failed; pembayaran terlambat masuk kasus rekonsiliasi. Charge timeout tidak diterbitkan ulang sembarangan. Manual POS tidak menambah wallet. Saldo baru tidak otomatis tersedia. Payout rejected tidak bisa completed; support tidak dapat mengubah dana. Build seluruh aplikasi dan pengujian regresi harus lulus. Bukti live DOKU, deployment, backup restore dan settlement nyata tetap merupakan langkah operasional terpisah yang membutuhkan lingkungan merchant.
