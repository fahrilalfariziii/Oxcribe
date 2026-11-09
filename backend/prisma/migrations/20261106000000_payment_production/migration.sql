-- Additive finance schema also covers installations that used db push for the wallet.
CREATE TABLE IF NOT EXISTS "merchant_wallets" (
  "id" SERIAL PRIMARY KEY,
  "business_id" INTEGER NOT NULL UNIQUE REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "available_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "pending_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "auto_payout_enabled" BOOLEAN NOT NULL DEFAULT false,
  "payout_frequency" TEXT NOT NULL DEFAULT 'manual',
  "payout_day" INTEGER,
  "minimum_payout" DECIMAL(14,2) NOT NULL DEFAULT 50000,
  "hold_min_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "bank_code" TEXT, "bank_account" TEXT, "account_name" TEXT,
  "is_bank_verified" BOOLEAN NOT NULL DEFAULT false,
  "bank_verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
  "id" SERIAL PRIMARY KEY,
  "wallet_id" INTEGER NOT NULL REFERENCES "merchant_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
  "balance_before" DECIMAL(14,2) NOT NULL, "balance_after" DECIMAL(14,2) NOT NULL,
  "reference_id" TEXT, "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "payout_requests" (
  "id" SERIAL PRIMARY KEY,
  "wallet_id" INTEGER NOT NULL REFERENCES "merchant_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "request_number" TEXT NOT NULL UNIQUE,
  "source" TEXT NOT NULL DEFAULT 'on_demand', "amount" DECIMAL(14,2) NOT NULL,
  "bank_code" TEXT NOT NULL, "bank_account" TEXT NOT NULL, "account_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "rejection_reason" TEXT,
  "bank_ref_number" TEXT, "proof_image_url" TEXT, "processed_by_admin_id" INTEGER,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "merchant_wallets" ADD COLUMN IF NOT EXISTS "reserved_balance" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "payout_requests" ADD COLUMN IF NOT EXISTS "schedule_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payout_requests_schedule_key_key" ON "payout_requests"("schedule_key");

-- These amounts were already deducted from available by the legacy payout code.
UPDATE "merchant_wallets" w SET "reserved_balance" = (
  SELECT COALESCE(SUM(p."amount"),0) FROM "payout_requests" p
  WHERE p."wallet_id"=w."id" AND p."status" IN ('pending','processing')
);
-- Old simulated verification is not evidence of bank ownership.
UPDATE "merchant_wallets" SET "is_bank_verified"=false, "bank_verified_at"=NULL;

ALTER TABLE "payments" ADD COLUMN "settled_at" TIMESTAMP(3),
  ADD COLUMN "settlement_reference" TEXT,
  ADD COLUMN "gateway_fee_actual" DECIMAL(14,2),
  ADD COLUMN "settled_net" DECIMAL(14,2),
  ADD COLUMN "refunded_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "refund_metadata" JSONB,
  ADD COLUMN "review_reason" TEXT;

CREATE TABLE "payment_attempts" (
  "id" SERIAL PRIMARY KEY,
  "payment_id" INTEGER NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "partner_reference_no" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'creating', "amount" DECIMAL(14,2) NOT NULL,
  "response" JSONB, "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "payment_attempts_partner_reference_no_key" ON "payment_attempts"("partner_reference_no");
CREATE INDEX "payment_attempts_payment_id_created_at_idx" ON "payment_attempts"("payment_id","created_at");
CREATE INDEX "payment_attempts_status_updated_at_idx" ON "payment_attempts"("status","updated_at");

CREATE TABLE "payment_notifications" (
  "id" SERIAL PRIMARY KEY, "event_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "headers" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT, "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "payment_notifications_event_key_key" ON "payment_notifications"("event_key");
CREATE INDEX "payment_notifications_status_next_attempt_at_idx" ON "payment_notifications"("status","next_attempt_at");

-- Retain known QRIS references for status checks and delayed callbacks after upgrade.
INSERT INTO "payment_attempts" ("payment_id","partner_reference_no","status","amount","response","updated_at")
SELECT p."id", p."gateway_data"->>'partnerReferenceNo',
  CASE WHEN p."status"='paid' THEN 'paid' ELSE 'unknown' END,
  p."amount", p."gateway_data", CURRENT_TIMESTAMP
FROM "payments" p
WHERE p."gateway"='doku' AND p."method"='qris'
AND NULLIF(p."gateway_data"->>'partnerReferenceNo','') IS NOT NULL
ON CONFLICT ("partner_reference_no") DO NOTHING;

-- Do not repair historical duplicate money silently: mark it for reconciliation.
WITH existing_inflows AS (
  SELECT t."id",p."id" AS payment_id,
    ROW_NUMBER() OVER(PARTITION BY p."id" ORDER BY t."id") AS n
  FROM "wallet_transactions" t
  JOIN "merchant_wallets" w ON w."id"=t."wallet_id"
  JOIN "orders" o ON o."business_id"=w."business_id" AND o."order_number"=t."reference_id"
  JOIN "payments" p ON p."order_id"=o."id" AND p."gateway"='doku'
  WHERE t."type"='ORDER_INFLOW'
)
UPDATE "wallet_transactions" t SET "idempotency_key"='payment:'||e.payment_id||':inflow'
FROM existing_inflows e WHERE t."id"=e."id" AND e.n=1 AND t."idempotency_key" IS NULL;

UPDATE "payments" p SET "review_reason"='legacy_balance_requires_reconciliation'
WHERE p."gateway"='doku' AND p."status"='paid';

-- Archive unused experiment settings in the existing immutable audit history.
INSERT INTO "platform_audit_logs" ("business_id","action","before","after")
SELECT "id", 'legacy_payment_config_archived', jsonb_build_object(
  'profileId',"doku_profile_id", 'accounts',"doku_sub_accounts",
  'status',"doku_sub_account_status", 'splitRuleId',"doku_split_rule_id",
  'bankCode',"doku_settlement_bank_code", 'bankAccount',"doku_settlement_bank_account",
  'bankName',"doku_settlement_bank_name", 'settlementStatus',"doku_settlement_status"
), '{}'::jsonb FROM "businesses";

ALTER TABLE "businesses" DROP COLUMN "doku_profile_id", DROP COLUMN "doku_sub_accounts",
  DROP COLUMN "doku_sub_account_status", DROP COLUMN "doku_split_rule_id",
  DROP COLUMN "doku_settlement_bank_code", DROP COLUMN "doku_settlement_bank_account",
  DROP COLUMN "doku_settlement_bank_name", DROP COLUMN "doku_settlement_status";
