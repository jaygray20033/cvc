/*
  Warnings:

  - You are about to drop the column `totpEnabledAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `totpSecret` on the `users` table. All the data in the column will be lost.

*/
-- Keep the raw-SQL FULLTEXT ngram index created by the P2.23 migration
-- (Prisma cannot declare it; do NOT drop it here).

-- AlterTable
ALTER TABLE `bank_accounts` ADD COLUMN `organizationId` VARCHAR(191) NULL,
    MODIFY `userId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `organizations` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `taxId` VARCHAR(32) NULL,
    `contact` VARCHAR(191) NULL,
    `phone` VARCHAR(20) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `ownerId` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `organizations_ownerId_idx`(`ownerId`),
    INDEX `organizations_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `totp_secrets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secretEnc` VARCHAR(255) NOT NULL,
    `enabledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `totp_secrets_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill TOTP secrets from users before the columns are dropped.
INSERT INTO `totp_secrets` (`id`, `userId`, `secretEnc`, `enabledAt`, `createdAt`, `updatedAt`)
SELECT CONCAT('totp_', REPLACE(UUID(), '-', '')), `id`, `totpSecret`, `totpEnabledAt`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `users`
WHERE `totpSecret` IS NOT NULL;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `totpEnabledAt`,
    DROP COLUMN `totpSecret`;

-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `sortIndex` INTEGER NOT NULL DEFAULT 0,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `categories_slug_key`(`slug`),
    INDEX `categories_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `spec` VARCHAR(500) NULL,
    `moq` INTEGER NOT NULL DEFAULT 1,
    `leadTimeDays` INTEGER NULL,
    `priceRef` DECIMAL(18, 2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_sku_key`(`sku`),
    INDEX `products_categoryId_status_idx`(`categoryId`, `status`),
    INDEX `products_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_images` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `alt` VARCHAR(200) NULL,
    `sortIndex` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_images_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_specs` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `value` VARCHAR(255) NOT NULL,
    `sortIndex` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_specs_productId_key_key`(`productId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `province` VARCHAR(100) NULL,
    `country` VARCHAR(2) NOT NULL DEFAULT 'CN',
    `contactName` VARCHAR(100) NULL,
    `contactPhone` VARCHAR(32) NULL,
    `contactWechat` VARCHAR(64) NULL,
    `address` VARCHAR(500) NULL,
    `notes` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `suppliers_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(100) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `supplier_accounts_userId_key`(`userId`),
    INDEX `supplier_accounts_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_products` (
    `id` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `supplierSku` VARCHAR(64) NULL,
    `costPrice` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'CNY',
    `moq` INTEGER NOT NULL DEFAULT 1,
    `leadTimeDays` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `supplier_products_supplierId_productId_key`(`supplierId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partner_banners` (
    `id` VARCHAR(191) NOT NULL,
    `partnerType` ENUM('SUPPLIER', 'SHIPPING') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `logoFileObjectId` VARCHAR(191) NULL,
    `linkUrl` VARCHAR(500) NULL,
    `position` ENUM('HOME_TOP', 'HOME_MID', 'CATEGORY_SIDEBAR', 'SEARCH_SIDEBAR') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortIndex` INTEGER NOT NULL DEFAULT 0,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `partner_banners_position_isActive_idx`(`position`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sourcing_requests` (
    `id` VARCHAR(191) NOT NULL,
    `requestNo` VARCHAR(32) NOT NULL,
    `buyerId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` VARCHAR(2000) NULL,
    `quantity` INTEGER NULL,
    `targetPrice` DECIMAL(18, 2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `expiresAt` DATETIME(3) NULL,
    `status` ENUM('OPEN', 'QUOTED', 'CONVERTED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sourcing_requests_requestNo_key`(`requestNo`),
    INDEX `sourcing_requests_buyerId_status_idx`(`buyerId`, `status`),
    INDEX `sourcing_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sourcing_request_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `fileObjectId` VARCHAR(191) NULL,
    `sortIndex` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sourcing_request_attachments_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotes` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `unitPrice` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `moq` INTEGER NOT NULL DEFAULT 1,
    `leadTimeDays` INTEGER NOT NULL DEFAULT 7,
    `validUntil` DATETIME(3) NULL,
    `note` VARCHAR(1000) NULL,
    `status` ENUM('SUBMITTED', 'SELECTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'SUBMITTED',
    `selectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `quotes_requestId_status_idx`(`requestId`, `status`),
    INDEX `quotes_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quote_selections` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NOT NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quote_selections_requestId_key`(`requestId`),
    UNIQUE INDEX `quote_selections_quoteId_key`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(32) NOT NULL,
    `buyerId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `sourcingRequestId` VARCHAR(191) NULL,
    `selectedQuoteId` VARCHAR(191) NULL,
    `status` ENUM('NEGOTIATING', 'SAMPLING', 'CONTRACT', 'DEPOSIT', 'PRODUCTION', 'QC', 'FINAL_PAYMENT', 'SHIPPING', 'RECEIVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'NEGOTIATING',
    `stageIndex` INTEGER NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(18, 2) NOT NULL,
    `depositAmount` DECIMAL(18, 2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `note` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_orderNo_key`(`orderNo`),
    INDEX `orders_buyerId_status_idx`(`buyerId`, `status`),
    INDEX `orders_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `orders_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_stage_logs` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `stageIndex` INTEGER NOT NULL,
    `status` ENUM('NEGOTIATING', 'SAMPLING', 'CONTRACT', 'DEPOSIT', 'PRODUCTION', 'QC', 'FINAL_PAYMENT', 'SHIPPING', 'RECEIVED', 'COMPLETED', 'CANCELLED') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `note` VARCHAR(500) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `order_stage_logs_orderId_stageIndex_idx`(`orderId`, `stageIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_events` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `message` VARCHAR(500) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `order_events_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `samples` (
    `id` VARCHAR(191) NOT NULL,
    `sampleNo` VARCHAR(32) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `status` ENUM('REQUESTED', 'SHIPPED', 'DELIVERED', 'APPROVED', 'REJECTED', 'STOPPED') NOT NULL DEFAULT 'REQUESTED',
    `note` VARCHAR(500) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `samples_sampleNo_key`(`sampleNo`),
    INDEX `samples_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sample_stops` (
    `id` VARCHAR(191) NOT NULL,
    `sampleId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sample_stops_sampleId_idx`(`sampleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shipments` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `carrier` VARCHAR(100) NOT NULL,
    `trackingNo` VARCHAR(100) NOT NULL,
    `trackingUrl` VARCHAR(500) NULL,
    `proofFileObjectId` VARCHAR(191) NULL,
    `status` ENUM('PREPARING', 'IN_TRANSIT', 'DELIVERED', 'RETURNED') NOT NULL DEFAULT 'PREPARING',
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `shipments_orderId_idx`(`orderId`),
    INDEX `shipments_trackingNo_idx`(`trackingNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shipment_stops` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `enteredById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `shipment_stops_shipmentId_occurredAt_idx`(`shipmentId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claims` (
    `id` VARCHAR(191) NOT NULL,
    `claimNo` VARCHAR(32) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `type` ENUM('QUALITY', 'DAMAGED', 'MISSING', 'WRONG_ITEM', 'OTHER') NOT NULL,
    `reason` VARCHAR(2000) NOT NULL,
    `status` ENUM('OPEN', 'PROPOSED', 'RESOLVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `filedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `claims_claimNo_key`(`claimNo`),
    INDEX `claims_orderId_status_idx`(`orderId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claim_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `claimId` VARCHAR(191) NOT NULL,
    `kind` ENUM('REFUND', 'PARTIAL_REFUND', 'RETURN', 'REPLACE', 'COMPENSATE') NOT NULL,
    `amount` DECIMAL(18, 2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `note` VARCHAR(1000) NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `proposedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `claim_proposals_claimId_idx`(`claimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claim_resolutions` (
    `id` VARCHAR(191) NOT NULL,
    `claimId` VARCHAR(191) NOT NULL,
    `decision` ENUM('REFUND', 'PARTIAL_REFUND', 'REPLACE', 'COMPENSATE', 'REJECT') NOT NULL,
    `note` VARCHAR(1000) NULL,
    `decidedById` VARCHAR(191) NOT NULL,
    `decidedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `claim_resolutions_claimId_key`(`claimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_shipments` (
    `id` VARCHAR(191) NOT NULL,
    `claimId` VARCHAR(191) NOT NULL,
    `direction` ENUM('RETURN_TO_SUPPLIER', 'REPLACEMENT_TO_BUYER') NOT NULL,
    `carrier` VARCHAR(100) NOT NULL,
    `trackingNo` VARCHAR(100) NOT NULL,
    `proofFileObjectId` VARCHAR(191) NULL,
    `status` ENUM('PREPARING', 'IN_TRANSIT', 'DELIVERED', 'RETURNED') NOT NULL DEFAULT 'PREPARING',
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `return_shipments_claimId_idx`(`claimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `claimId` VARCHAR(191) NULL,
    `bankAccountId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `method` ENUM('BANK_TRANSFER', 'WALLET') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `paymentRef` VARCHAR(64) NULL,
    `note` VARCHAR(500) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `refunds_orderId_status_idx`(`orderId`, `status`),
    INDEX `refunds_claimId_idx`(`claimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `bank_accounts_organizationId_idx` ON `bank_accounts`(`organizationId`);

-- AddForeignKey
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organizations` ADD CONSTRAINT `organizations_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `totp_secrets` ADD CONSTRAINT `totp_secrets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_specs` ADD CONSTRAINT `product_specs_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_accounts` ADD CONSTRAINT `supplier_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_accounts` ADD CONSTRAINT `supplier_accounts_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_banners` ADD CONSTRAINT `partner_banners_logoFileObjectId_fkey` FOREIGN KEY (`logoFileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_requests` ADD CONSTRAINT `sourcing_requests_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_attachments` ADD CONSTRAINT `sourcing_request_attachments_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sourcing_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_attachments` ADD CONSTRAINT `sourcing_request_attachments_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sourcing_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_selections` ADD CONSTRAINT `quote_selections_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sourcing_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_selections` ADD CONSTRAINT `quote_selections_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `quotes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_selections` ADD CONSTRAINT `quote_selections_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_sourcingRequestId_fkey` FOREIGN KEY (`sourcingRequestId`) REFERENCES `sourcing_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_selectedQuoteId_fkey` FOREIGN KEY (`selectedQuoteId`) REFERENCES `quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_stage_logs` ADD CONSTRAINT `order_stage_logs_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `samples` ADD CONSTRAINT `samples_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sample_stops` ADD CONSTRAINT `sample_stops_sampleId_fkey` FOREIGN KEY (`sampleId`) REFERENCES `samples`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_proofFileObjectId_fkey` FOREIGN KEY (`proofFileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipment_stops` ADD CONSTRAINT `shipment_stops_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `shipments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipment_stops` ADD CONSTRAINT `shipment_stops_enteredById_fkey` FOREIGN KEY (`enteredById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claims` ADD CONSTRAINT `claims_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claims` ADD CONSTRAINT `claims_filedById_fkey` FOREIGN KEY (`filedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_proposals` ADD CONSTRAINT `claim_proposals_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `claims`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_proposals` ADD CONSTRAINT `claim_proposals_proposedById_fkey` FOREIGN KEY (`proposedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_resolutions` ADD CONSTRAINT `claim_resolutions_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `claims`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_resolutions` ADD CONSTRAINT `claim_resolutions_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_shipments` ADD CONSTRAINT `return_shipments_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `claims`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_shipments` ADD CONSTRAINT `return_shipments_proofFileObjectId_fkey` FOREIGN KEY (`proofFileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `claims`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
