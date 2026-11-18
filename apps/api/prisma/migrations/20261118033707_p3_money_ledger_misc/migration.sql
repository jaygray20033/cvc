
-- CreateTable
CREATE TABLE `wallets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `balance` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'FROZEN') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wallets_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
    `walletId` VARCHAR(191) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ledger_accounts_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `expectedEntries` INTEGER NOT NULL DEFAULT 2,
    `type` ENUM('DEPOSIT', 'PAYMENT', 'PAYOUT', 'FEE', 'REFUND', 'ADJUSTMENT', 'SETTLEMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `status` ENUM('DRAFT', 'POSTED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `postedAt` DATETIME(3) NULL,
    `refType` VARCHAR(32) NULL,
    `refId` VARCHAR(64) NULL,
    `note` VARCHAR(500) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ledger_transactions_refType_refId_idx`(`refType`, `refId`),
    INDEX `ledger_transactions_status_postedAt_idx`(`status`, `postedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `side` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `refType` VARCHAR(32) NULL,
    `refId` VARCHAR(64) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ledger_entries_transactionId_idx`(`transactionId`),
    INDEX `ledger_entries_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receiving_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(100) NOT NULL,
    `holderName` VARCHAR(191) NOT NULL,
    `accountNoEnc` VARCHAR(255) NOT NULL,
    `accountNoLast4` VARCHAR(4) NOT NULL,
    `accountNoHash` VARCHAR(64) NOT NULL,
    `bankCode` VARCHAR(32) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `receiving_accounts_accountNoHash_key`(`accountNoHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `paymentNo` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `purposeType` VARCHAR(32) NULL,
    `purposeId` VARCHAR(64) NULL,
    `receivingAccountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `status` ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `confirmedById` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_paymentNo_key`(`paymentNo`),
    INDEX `payments_userId_status_idx`(`userId`, `status`),
    INDEX `payments_purposeType_purposeId_idx`(`purposeType`, `purposeId`),
    INDEX `payments_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_proofs` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `uploadedById` VARCHAR(191) NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_proofs_sha256_idx`(`sha256`),
    UNIQUE INDEX `payment_proofs_paymentId_sha256_key`(`paymentId`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payouts` (
    `id` VARCHAR(191) NOT NULL,
    `payoutNo` VARCHAR(32) NOT NULL,
    `payeeType` VARCHAR(32) NOT NULL,
    `payeeId` VARCHAR(64) NOT NULL,
    `bankAccountId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payouts_payoutNo_key`(`payoutNo`),
    INDEX `payouts_payeeType_payeeId_idx`(`payeeType`, `payeeId`),
    INDEX `payouts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payout_proofs` (
    `id` VARCHAR(191) NOT NULL,
    `payoutId` VARCHAR(191) NOT NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `uploadedById` VARCHAR(191) NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payout_proofs_payoutId_sha256_key`(`payoutId`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_statement_imports` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `fileHash` VARCHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `totalLines` INTEGER NOT NULL DEFAULT 0,
    `importedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bank_statement_imports_fileHash_key`(`fileHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_statement_lines` (
    `id` VARCHAR(191) NOT NULL,
    `importId` VARCHAR(191) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `transactionDate` DATETIME(3) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `matchedPaymentId` VARCHAR(191) NULL,
    `matchedPayoutId` VARCHAR(191) NULL,
    `status` ENUM('UNMATCHED', 'MATCHED', 'IGNORED') NOT NULL DEFAULT 'UNMATCHED',
    `matchedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bank_statement_lines_status_idx`(`status`),
    UNIQUE INDEX `bank_statement_lines_importId_lineNo_key`(`importId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdrawals` (
    `id` VARCHAR(191) NOT NULL,
    `walletId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `bankAccountId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `payoutId` VARCHAR(191) NULL,
    `processedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `withdrawals_walletId_status_idx`(`walletId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlements` (
    `id` VARCHAR(191) NOT NULL,
    `settlementNo` VARCHAR(32) NOT NULL,
    `ownerType` VARCHAR(32) NOT NULL,
    `ownerId` VARCHAR(64) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `status` ENUM('PENDING', 'APPROVED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `payoutId` VARCHAR(191) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `settlements_settlementNo_key`(`settlementNo`),
    INDEX `settlements_ownerType_ownerId_idx`(`ownerType`, `ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconciliation_runs` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(32) NOT NULL DEFAULT 'payments',
    `ranById` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `status` ENUM('RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `summary` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reconciliation_runs_status_startedAt_idx`(`status`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconciliation_items` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `kind` ENUM('MISSING', 'MISMATCH', 'DUPLICATE', 'UNMATCHED') NOT NULL,
    `refType` VARCHAR(32) NULL,
    `refId` VARCHAR(64) NULL,
    `detail` JSON NULL,
    `status` ENUM('OPEN', 'RESOLVED', 'IGNORED') NOT NULL DEFAULT 'OPEN',
    `resolvedById` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reconciliation_items_runId_kind_idx`(`runId`, `kind`),
    INDEX `reconciliation_items_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(32) NOT NULL,
    `ownerType` VARCHAR(32) NOT NULL,
    `ownerId` VARCHAR(64) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `status` ENUM('DRAFT', 'ISSUED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `issuedAt` DATETIME(3) NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_invoiceNo_key`(`invoiceNo`),
    INDEX `invoices_ownerType_ownerId_idx`(`ownerType`, `ownerId`),
    INDEX `invoices_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exchange_rates` (
    `id` VARCHAR(191) NOT NULL,
    `baseCode` VARCHAR(3) NOT NULL,
    `quoteCode` VARCHAR(3) NOT NULL,
    `rate` DECIMAL(18, 8) NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `source` ENUM('MANUAL', 'AUTO') NOT NULL DEFAULT 'MANUAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `exchange_rates_baseCode_quoteCode_effectiveAt_key`(`baseCode`, `quoteCode`, `effectiveAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `funding_applications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `amountRequested` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `purpose` VARCHAR(1000) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `funding_applications_userId_status_idx`(`userId`, `status`),
    INDEX `funding_applications_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_contacts` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(191) NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT 'lead',
    `userId` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_contacts_type_idx`(`type`),
    INDEX `crm_contacts_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_activities` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `type` ENUM('CALL', 'EMAIL', 'VISIT', 'NOTE', 'OTHER') NOT NULL,
    `subject` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_activities_contactId_occurredAt_idx`(`contactId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `showroom_visits` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `visitedAt` DATETIME(3) NULL,
    `status` ENUM('SCHEDULED', 'DONE', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
    `note` VARCHAR(500) NULL,
    `actorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `showroom_visits_contactId_idx`(`contactId`),
    INDEX `showroom_visits_scheduledAt_idx`(`scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `params` JSON NULL,
    `result` JSON NULL,
    `status` ENUM('DRAFT', 'READY', 'FAILED') NOT NULL DEFAULT 'READY',
    `generatedById` VARCHAR(191) NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reports_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_walletId_fkey` FOREIGN KEY (`walletId`) REFERENCES `wallets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_transactions` ADD CONSTRAINT `ledger_transactions_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `ledger_transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `ledger_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_receivingAccountId_fkey` FOREIGN KEY (`receivingAccountId`) REFERENCES `receiving_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_proofs` ADD CONSTRAINT `payment_proofs_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_proofs` ADD CONSTRAINT `payment_proofs_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_proofs` ADD CONSTRAINT `payment_proofs_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payout_proofs` ADD CONSTRAINT `payout_proofs_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `payouts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payout_proofs` ADD CONSTRAINT `payout_proofs_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payout_proofs` ADD CONSTRAINT `payout_proofs_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_statement_imports` ADD CONSTRAINT `bank_statement_imports_importedById_fkey` FOREIGN KEY (`importedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_statement_lines` ADD CONSTRAINT `bank_statement_lines_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `bank_statement_imports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_statement_lines` ADD CONSTRAINT `bank_statement_lines_matchedPaymentId_fkey` FOREIGN KEY (`matchedPaymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_statement_lines` ADD CONSTRAINT `bank_statement_lines_matchedPayoutId_fkey` FOREIGN KEY (`matchedPayoutId`) REFERENCES `payouts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_walletId_fkey` FOREIGN KEY (`walletId`) REFERENCES `wallets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `payouts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `payouts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_runs` ADD CONSTRAINT `reconciliation_runs_ranById_fkey` FOREIGN KEY (`ranById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_items` ADD CONSTRAINT `reconciliation_items_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `reconciliation_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_items` ADD CONSTRAINT `reconciliation_items_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funding_applications` ADD CONSTRAINT `funding_applications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funding_applications` ADD CONSTRAINT `funding_applications_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_contacts` ADD CONSTRAINT `crm_contacts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_contacts` ADD CONSTRAINT `crm_contacts_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_activities` ADD CONSTRAINT `crm_activities_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `crm_contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_activities` ADD CONSTRAINT `crm_activities_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `showroom_visits` ADD CONSTRAINT `showroom_visits_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `crm_contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `showroom_visits` ADD CONSTRAINT `showroom_visits_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `showroom_visits` ADD CONSTRAINT `showroom_visits_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_generatedById_fkey` FOREIGN KEY (`generatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints on non-FK columns (MySQL forbids CHECK on FK columns that
-- carry referential actions like CASCADE/SET NULL, so only plain columns).
-- Money and quantity invariants live at the DB level, not just in services.
-- ---------------------------------------------------------------------------

ALTER TABLE `wallets` ADD CONSTRAINT `cvc_chk_wallets_balance` CHECK (`balance` >= 0);
ALTER TABLE `ledger_entries` ADD CONSTRAINT `cvc_chk_ledger_entries_amount` CHECK (`amount` > 0);
ALTER TABLE `payments` ADD CONSTRAINT `cvc_chk_payments_amount` CHECK (`amount` > 0);
ALTER TABLE `payouts` ADD CONSTRAINT `cvc_chk_payouts_amount` CHECK (`amount` > 0);
ALTER TABLE `withdrawals` ADD CONSTRAINT `cvc_chk_withdrawals_amount` CHECK (`amount` > 0);
ALTER TABLE `settlements` ADD CONSTRAINT `cvc_chk_settlements_amount` CHECK (`amount` >= 0);
ALTER TABLE `invoices` ADD CONSTRAINT `cvc_chk_invoices_amount` CHECK (`amount` >= 0);
ALTER TABLE `funding_applications` ADD CONSTRAINT `cvc_chk_funding_amount` CHECK (`amountRequested` >= 0);

ALTER TABLE `orders` ADD CONSTRAINT `cvc_chk_orders_total` CHECK (`totalAmount` >= 0);
ALTER TABLE `orders` ADD CONSTRAINT `cvc_chk_orders_deposit` CHECK (`depositAmount` >= 0);
ALTER TABLE `quotes` ADD CONSTRAINT `cvc_chk_quotes_unit_price` CHECK (`unitPrice` >= 0);
ALTER TABLE `offers` ADD CONSTRAINT `cvc_chk_offers_quantity` CHECK (`quantity` > 0);
ALTER TABLE `campaigns` ADD CONSTRAINT `cvc_chk_campaigns_capacity` CHECK (`capacity` >= 0);
ALTER TABLE `participations` ADD CONSTRAINT `cvc_chk_participations_units` CHECK (`unitsBought` >= 0);
ALTER TABLE `participations` ADD CONSTRAINT `cvc_chk_participations_paid` CHECK (`amountPaid` >= 0);
ALTER TABLE `participation_lines` ADD CONSTRAINT `cvc_chk_participation_lines_units` CHECK (`unitsBought` >= 0);
ALTER TABLE `goods_requests` ADD CONSTRAINT `cvc_chk_goods_requests_qty` CHECK (`quantity` >= 0);
ALTER TABLE `return_requests` ADD CONSTRAINT `cvc_chk_return_requests_qty` CHECK (`quantity` >= 0);
ALTER TABLE `allocation_lines` ADD CONSTRAINT `cvc_chk_allocation_lines_qty` CHECK (`quantity` >= 0);
ALTER TABLE `transfers` ADD CONSTRAINT `cvc_chk_transfers_qty` CHECK (`quantity` > 0);
ALTER TABLE `sales` ADD CONSTRAINT `cvc_chk_sales_total` CHECK (`totalAmount` >= 0);
ALTER TABLE `sale_lines` ADD CONSTRAINT `cvc_chk_sale_lines_qty` CHECK (`quantity` >= 0);
ALTER TABLE `sale_lines` ADD CONSTRAINT `cvc_chk_sale_lines_price` CHECK (`unitPrice` >= 0);
ALTER TABLE `inventory_balances` ADD CONSTRAINT `cvc_chk_inventory_balances_qty` CHECK (`quantity` >= 0);
ALTER TABLE `resale_listings` ADD CONSTRAINT `cvc_chk_resale_listings_price` CHECK (`salePrice` >= 0);
ALTER TABLE `order_stage_logs` ADD CONSTRAINT `cvc_chk_order_stage_logs_stage` CHECK (`stageIndex` >= 0);
ALTER TABLE `refunds` ADD CONSTRAINT `cvc_chk_refunds_amount` CHECK (`amount` >= 0);

-- ---------------------------------------------------------------------------
-- Ledger immutability + double-entry balance (P3.9, DB-enforced).
-- LedgerEntry rows are immutable: UPDATE/DELETE is blocked unless the operator
-- explicitly unlocks the session (@cvc_ledger_unlocked = 1) for maintenance.
-- Balance is checked once a transaction has collected all of its entries:
-- SUM(debit) must equal SUM(credit).
-- ---------------------------------------------------------------------------

CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON `ledger_entries` FOR EACH ROW
BEGIN
  IF @cvc_ledger_unlocked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_ENTRY_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON `ledger_entries` FOR EACH ROW
BEGIN
  IF @cvc_ledger_unlocked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_ENTRY_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER ledger_entries_balanced AFTER INSERT ON `ledger_entries` FOR EACH ROW
BEGIN
  DECLARE n INT;
  DECLARE d DECIMAL(18,2);
  DECLARE c DECIMAL(18,2);
  DECLARE expected INT;
  SELECT COUNT(*),
         COALESCE(SUM(CASE WHEN `side` = 'DEBIT' THEN `amount` ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN `side` = 'CREDIT' THEN `amount` ELSE 0 END), 0)
    INTO n, d, c
    FROM `ledger_entries`
    WHERE `transactionId` = NEW.`transactionId`;
  SELECT `expectedEntries` INTO expected
    FROM `ledger_transactions` WHERE `id` = NEW.`transactionId`;
  IF n >= expected AND d <> c THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_UNBALANCED';
  END IF;
END;
