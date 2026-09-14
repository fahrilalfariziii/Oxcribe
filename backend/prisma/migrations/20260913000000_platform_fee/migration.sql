-- Platform fee self-order non-tunai (per kafe) + snapshot fee & estimasi MDR per order
ALTER TABLE "businesses" ADD COLUMN     "platform_fee_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN     "platform_fee_mode" TEXT NOT NULL DEFAULT 'percent';
ALTER TABLE "businesses" ADD COLUMN     "platform_fee_percent" DECIMAL(6,4) NOT NULL DEFAULT 0;
ALTER TABLE "businesses" ADD COLUMN     "platform_fee_flat" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "businesses" ADD COLUMN     "platform_fee_bearer" TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE "orders" ADD COLUMN     "platform_fee" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN     "platform_fee_bearer" TEXT;
ALTER TABLE "orders" ADD COLUMN     "mdr_fee" DECIMAL(14,2) NOT NULL DEFAULT 0;
