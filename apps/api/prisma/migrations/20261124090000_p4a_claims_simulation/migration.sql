-- P4.22 claims flow snapshot fields + evidence table; P4.21 simulation flag.
-- MySQL enums are extended with MODIFY (old values stay for legacy rows).

ALTER TABLE `claims` ADD COLUMN `actualQuantity` INTEGER NULL,
    ADD COLUMN `amount` DECIMAL(18, 2) NULL,
    ADD COLUMN `chosenAt` DATETIME(3) NULL,
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    ADD COLUMN `missingQuantity` INTEGER NULL,
    ADD COLUMN `orderedQuantity` INTEGER NULL,
    ADD COLUMN `proposedAt` DATETIME(3) NULL,
    ADD COLUMN `resolutionKind` VARCHAR(32) NULL,
    ADD COLUMN `topupDeliveredAt` DATETIME(3) NULL,
    ADD COLUMN `topupStage` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `unitPrice` DECIMAL(18, 2) NULL,
    MODIFY `status` ENUM('OPEN', 'PROPOSED', 'RESOLVED', 'REJECTED', 'CANCELLED', 'RESOLUTION_CHOSEN', 'TOPUP_PENDING', 'TOPUP_CONFIRMED', 'RETURN_SENT', 'RETURN_RECEIVED', 'REFUND_EXECUTED', 'REFUND_CONFIRMED', 'CLOSED', 'WITHDRAWN') NOT NULL DEFAULT 'OPEN';

CREATE TABLE `order_simulations` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastPumpedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `order_simulations_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `claim_evidence` (
    `id` VARCHAR(191) NOT NULL,
    `claimId` VARCHAR(191) NOT NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'PHOTO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `claim_evidence_claimId_idx`(`claimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_simulations` ADD CONSTRAINT `order_simulations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `claim_evidence` ADD CONSTRAINT `claim_evidence_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `claims`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `claim_evidence` ADD CONSTRAINT `claim_evidence_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Quantities/money are never negative (CHECK on non-FK columns only).
ALTER TABLE `claims` ADD CONSTRAINT `cvc_chk_claims_missing` CHECK (`missingQuantity` IS NULL OR `missingQuantity` >= 0);
ALTER TABLE `claims` ADD CONSTRAINT `cvc_chk_claims_amount` CHECK (`amount` IS NULL OR `amount` >= 0);
