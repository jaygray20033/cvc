-- AlterTable
ALTER TABLE `supplier_accounts` ADD COLUMN `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `supplier_products` ADD COLUMN `approvedAt` DATETIME(3) NULL;
