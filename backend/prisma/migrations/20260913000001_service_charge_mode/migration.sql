-- Service charge independen dari pajak + mode percent/flat (owner bebas on/off)
ALTER TABLE "businesses" ADD COLUMN     "service_charge_mode" TEXT NOT NULL DEFAULT 'percent';
ALTER TABLE "businesses" ADD COLUMN     "service_charge_flat" DECIMAL(14,2) NOT NULL DEFAULT 0;
