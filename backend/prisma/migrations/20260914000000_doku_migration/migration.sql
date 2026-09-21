-- Migrasi full Midtrans -> DOKU (global only, SNAP Direct API)
-- Hapus kolom per-business Midtrans; DOKU memakai env global saja.
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "midtrans_mode";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "midtrans_server_key_enc";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "midtrans_client_key";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "midtrans_qris_acquirer";
-- Tandai payment lama Midtrans agar histori tetap terbaca (tidak dihapus)
-- gateway lama "midtrans" dibiarkan apa adanya; order baru memakai gateway "doku".
