# Payment Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove DOKU experiments and make cash/QRIS Self-Order, ledger, manual reconciliation and payouts reliable.

**Architecture:** Central merchant collection; persisted QRIS attempts and notification inbox feed atomic payment/ledger transitions. Explicit per-payment settlement and manual payouts replace timer-based settlement and sub-account operations.

**Tech Stack:** Existing TypeScript, Express 4, Prisma 5, PostgreSQL, React/Vite; Node test runner without additional dependencies.

**Spec:** docs/superpowers/specs/2026-11-06-payment-production-design.md

## Global Constraints

- Never read .env or mutate the active database. Do not overwrite user AGENT.md changes.
- Self-Order accepts only cash and qris. Preserve POS manual bank-transfer history and functionality.
- Preserve historical migrations; prepare new migrations, no deploy/seed.
- No implicit settlement or payout API calls. Use explicit admin reconciliation and manual bank evidence.
- Approved recommendations are execution authorization; do not request the same approval again.

## Review Focus

- Duplicate and parallel webhook/poll delivery must not double-credit.
- Gateway timeout and late successful charge must retain a recoverable reference.
- Settlement and payout concurrent requests must not create/lose funds.
- Stale bank transfer config/history must not re-enable VA Self-Order.
- Support role, rejected payouts, missing credentials and production offline mode must fail closed.

### Task 1: Shared schema, migration and test infrastructure

Owner: primary agent. Files: backend/prisma/schema.prisma, new migrations, backend/tests helpers, package scripts.
- [x] Add regression tests for schema migration integrity and money arithmetic; run RED.
- [x] Add PaymentAttempt, PaymentNotification and payment reconciliation/refund metadata; unique ledger idempotency key and reserved wallet balance. Remove experiment model fields through archival migration.
- [x] Add complete wallet DDL migration supporting fresh and existing installations; generate Prisma with synthetic environment, never read .env.
- [x] Run tests and typecheck; record results.

### Task 2: QRIS payment lifecycle

Owner: payment agent. Files: doku.service, public.routes, order.service, new payment worker/services/tests. No schema edits.
Interfaces: creditOrderInflow(input, tx?) must accept caller transaction; PaymentAttempt(paymentId,partnerReferenceNo,status,amount,response,error,createdAt,updatedAt); PaymentNotification(eventKey,payload,headers,status,attempts,error,nextAttemptAt,createdAt,updatedAt).
- [x] Write/run failing tests for cash/QRIS-only, idempotent attempts and atomic paid/credit, stale/invalid notifications.
- [x] Remove VA/sub-account charge implementation; persist attempts, verify inbox and worker retry/reconciliation; safe cancellation and paid transitions.
- [x] Run regression tests and backend typecheck, summarize evidence.

### Task 3: Wallet, payout and administration

Owner: wallet agent. Files: wallet.service, wallet.routes, platform.routes, scheduler, doku-inquiry service, tests. No schema edits.
Interfaces: MerchantWallet reservedBalance; WalletTransaction idempotencyKey optional unique; Payment settledAt, settlementReference, gatewayFeeActual, settledNet, refundedAmount default 0. PaymentAttempt has unique partnerReferenceNo.
- [x] Write/run RED for no implicit settlement, safe payout state/roles and manual verification.
- [x] Remove sub-account endpoints/service and auto-transfer experiments. Make wallet operations transaction-safe and settlement explicit per payment with statement reference/actual fee; manual refund reconciliation.
- [x] Scheduler only processes payout scheduling; QRIS worker integration is primary agent responsibility.
- [x] Run wallet regression tests and backend typecheck.

### Task 4: Frontend payment cleanup and manual finance controls

Owner: frontend agent. Files: apps/web-app, apps/admin. No backend edits.
- [x] Verify current apps, add targeted behavior coverage where practical.
- [x] Only cash/QRIS in Self-Order and settings; remove VA payload/options and admin sub-account operations. Preserve manual POS transfer and historical display.
- [x] Update finance UI for explicit settlement/reconciliation, payout processing/proof requirements and manual bank verification. Disable production offline financial actions.
- [x] Build web-app, admin and landing; report evidence and visual verification limits.

### Task 5: Integration and production operations

Owner: primary agent. Files: startup/config validation, CI, operational scripts/docs, integration tests.
- [x] Verify worker wiring, endpoint contracts, migration SQL and all regression tests.
- [x] Add validated production config, CI build/test, backup/restore and operational alert/runbook instructions without touching real infrastructure.
- [x] Review whole diff and fix important findings with regressions.
- [x] Run final tests, build all apps, schema validation; document remaining merchant/staging checks without claiming live readiness.

## Execution ledger

Ruling: execute in current workspace on a codex branch, leaving user changes untouched; no worktree creation without consent. Independent file ownership permits parallel agents under dispatching-parallel-agents. No automatic commit/push/deploy is requested.

## Verification record

- Branch: codex/qris-production-hardening. No commit, push, merge or deployment performed.
- Backend: 49 tests PASS, zero failures/skips with PAYMENT_TEST_DATABASE_URL pointing only to disposable PostgreSQL. Frontend: 4 behavior tests PASS. Root npm test runs both suites.
- All four builds PASS: backend, web-app, admin and landing. Web-app retains a Vite large-chunk warning; this is not a failed build.
- Schema validation PASS. All historical migrations applied successfully to a fresh disposable database. Upgrade fixture also preserved existing available/pending balances, initialized reserved payouts, reset bank verification and archived status-only experiment metadata before dropping old columns.
- Independent review found and fixed stale bank verification, manual POS payment-method validation and public API/SSE metadata disclosure. Each correction has regression coverage.
- Additional final correction: manual POS QRIS/transfer snapshots zero gateway MDR; Self-Order QRIS alone estimates MDR.
- Browser UI tool failed to initialize (trusted Node process exited). Automated HTTP/service/frontend policy tests and builds completed; visual/click-through accessibility verification remains a staging task.
- No real .env read or edit, no active application database changes, no live DOKU calls. Only the example configuration template was replaced.
- Production credentials/channel activation, callback registration, live small-value payments, real settlement, infrastructure monitoring and backup restore drill remain merchant/hosting acceptance steps in docs/Produksi-Pembayaran.md.
