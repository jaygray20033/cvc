-- P4.19 — manual P2P payments (proof + admin approval), production reports,
-- hand-entered shipment tracking; P4.20 — manual supplier payouts with
-- two-layer approval, proof of transfer and ledger posting on mark-paid.
ALTER TABLE `payment_proofs`
    ADD COLUMN `amount` DECIMAL(18, 2) NULL,
    ADD COLUMN `senderBank` VARCHAR(100) NULL,
    ADD COLUMN `transactionRef` VARCHAR(100) NULL,
    ADD COLUMN `transferredAt` DATETIME(3) NULL;

ALTER TABLE `payments`
    ADD COLUMN `approvedAmount` DECIMAL(18, 2) NULL,
    ADD COLUMN `dueAt` DATETIME(3) NULL,
    ADD COLUMN `expiredAt` DATETIME(3) NULL,
    ADD COLUMN `kind` ENUM('DEPOSIT', 'FINAL', 'SAMPLE_FEE') NOT NULL DEFAULT 'DEPOSIT',
    ADD COLUMN `proofSubmittedAt` DATETIME(3) NULL,
    ADD COLUMN `referenceCode` VARCHAR(32) NULL,
    ADD COLUMN `requestedAmount` DECIMAL(18, 2) NULL,
    MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED', 'AWAITING_PROOF', 'PROOF_SUBMITTED', 'APPROVED', 'PARTIAL', 'EXPIRED') NOT NULL DEFAULT 'PENDING';

ALTER TABLE `payout_proofs`
    ADD COLUMN `transactionRef` VARCHAR(100) NULL;

ALTER TABLE `payouts`
    ADD COLUMN `approvalCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `confirmedAt` DATETIME(3) NULL,
    ADD COLUMN `confirmedById` VARCHAR(64) NULL,
    ADD COLUMN `firstApprovedById` VARCHAR(64) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paidById` VARCHAR(64) NULL,
    ADD COLUMN `purposeId` VARCHAR(64) NULL,
    ADD COLUMN `purposeType` VARCHAR(32) NULL,
    ADD COLUMN `referenceCode` VARCHAR(32) NULL,
    ADD COLUMN `requiresSecondApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `secondApprovedAt` DATETIME(3) NULL,
    ADD COLUMN `secondApprovedById` VARCHAR(64) NULL,
    ADD COLUMN `transactionRef` VARCHAR(100) NULL;

ALTER TABLE `shipment_stops`
    ADD COLUMN `location` VARCHAR(200) NULL,
    ADD COLUMN `type` VARCHAR(32) NULL;

ALTER TABLE `shipments`
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `expectedAt` DATETIME(3) NULL,
    ADD COLUMN `lastReminderAt` DATETIME(3) NULL;

CREATE TABLE `production_reports` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `reportedById` VARCHAR(191) NULL,
    `note` VARCHAR(2000) NULL,
    `ready` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `production_reports_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_report_media` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'PHOTO',

    INDEX `production_report_media_reportId_idx`(`reportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `payment_proofs_transactionRef_key` ON `payment_proofs`(`transactionRef`);
CREATE UNIQUE INDEX `payments_referenceCode_key` ON `payments`(`referenceCode`);
CREATE INDEX `payments_dueAt_idx` ON `payments`(`dueAt`);
CREATE UNIQUE INDEX `payouts_referenceCode_key` ON `payouts`(`referenceCode`);
CREATE UNIQUE INDEX `payouts_transactionRef_key` ON `payouts`(`transactionRef`);
CREATE INDEX `payouts_purposeType_purposeId_idx` ON `payouts`(`purposeType`, `purposeId`);
CREATE INDEX `shipments_createdById_idx` ON `shipments`(`createdById`);

ALTER TABLE `shipments`
    ADD CONSTRAINT `shipments_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `production_reports`
    ADD CONSTRAINT `production_reports_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `production_reports`
    ADD CONSTRAINT `production_reports_reportedById_fkey` FOREIGN KEY (`reportedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `production_report_media`
    ADD CONSTRAINT `production_report_media_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `production_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `production_report_media`
    ADD CONSTRAINT `production_report_media_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
