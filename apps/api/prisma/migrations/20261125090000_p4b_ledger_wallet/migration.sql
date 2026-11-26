-- P4.23 double-entry ledger: caller-supplied idempotency key (unique when
-- present) and a statement-friendly index on entries.

ALTER TABLE `ledger_transactions`
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `ledger_transactions_idempotencyKey_key`(`idempotencyKey`);

CREATE INDEX `ledger_entries_accountId_createdAt_idx` ON `ledger_entries`(`accountId`, `createdAt`);

-- P4.24 wallet: `balance` is the total cached from the ledger, `heldBalance`
-- is reserved for pending withdrawals (available = balance - heldBalance).

ALTER TABLE `wallets`
    ADD COLUMN `heldBalance` DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE `wallets`
    ADD CONSTRAINT `cvc_chk_wallets_held_nonneg` CHECK (`heldBalance` >= 0);
