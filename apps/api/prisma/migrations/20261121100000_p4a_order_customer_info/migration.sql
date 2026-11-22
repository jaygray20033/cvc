-- P4.18 — legal customer snapshot per order, prefilled from Profile/KYC and
-- locked once a contract exists. CCCD is encrypted (AES-256-GCM).
CREATE TABLE `order_customer_info` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orgType` ENUM('PERSONAL', 'BUSINESS_HOUSEHOLD', 'COMPANY') NOT NULL DEFAULT 'PERSONAL',
    `legalName` VARCHAR(191) NOT NULL,
    `taxId` VARCHAR(14) NULL,
    `businessRegNo` VARCHAR(20) NULL,
    `cccdNumberEnc` VARCHAR(255) NULL,
    `cccdLast4` VARCHAR(4) NULL,
    `address` VARCHAR(255) NOT NULL,
    `representativeName` VARCHAR(191) NULL,
    `lockedAt` DATETIME(3) NULL,
    `lockedById` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `order_customer_info_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_customer_info`
    ADD CONSTRAINT `order_customer_info_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
