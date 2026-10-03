-- Sub-Account agregator DOKU (wallet-as-a-service V2) per tenant.
-- Routing charge memakai doku_profile_id (additionalInfo.account.id).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_profile_id" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_sub_accounts" JSONB;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_sub_account_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_split_rule_id" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_settlement_bank_code" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_settlement_bank_account" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_settlement_bank_name" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "doku_settlement_status" TEXT;
