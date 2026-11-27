-- P4.25 conservation checks (ledger balance, wallet cache, cash flow). The
-- latest run's status temporarily blocks withdrawals when it is MISMATCH.

CREATE TABLE `money_conservation_runs` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(40) NOT NULL,
    `status` ENUM('OK', 'MISMATCH') NOT NULL,
    `ledgerBalanced` BOOLEAN NOT NULL,
    `debitTotal` DECIMAL(18, 2) NOT NULL,
    `creditTotal` DECIMAL(18, 2) NOT NULL,
    `walletsChecked` INTEGER NOT NULL DEFAULT 0,
    `walletMismatches` INTEGER NOT NULL DEFAULT 0,
    `moneyIn` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `moneyOut` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `cashHeld` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `report` JSON NULL,
    `alertedAt` DATETIME(3) NULL,
    `triggeredById` VARCHAR(191) NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `money_conservation_runs_checkedAt_idx`(`checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
