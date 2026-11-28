-- P4.26 - user withdrawals: hold on request, two-layer approval above the
-- threshold, and manual bank transfer evidence (proof + transaction ref) before
-- the ledger is posted. Reject/cancel release the hold without a ledger entry
-- because the request itself never moved money.
ALTER TABLE `withdrawals`
    MODIFY `status` ENUM('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `withdrawalNo` VARCHAR(32) NOT NULL,
    ADD COLUMN `referenceCode` VARCHAR(32) NOT NULL,
    ADD COLUMN `requiresSecondApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `approvalCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `firstApprovedById` VARCHAR(64) NULL,
    ADD COLUMN `firstApprovedAt` DATETIME(3) NULL,
    ADD COLUMN `secondApprovedById` VARCHAR(64) NULL,
    ADD COLUMN `secondApprovedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(64) NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectedById` VARCHAR(64) NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectionReason` VARCHAR(500) NULL,
    ADD COLUMN `cancelledById` VARCHAR(64) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelReason` VARCHAR(500) NULL,
    ADD COLUMN `paidById` VARCHAR(64) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `transactionRef` VARCHAR(100) NULL,
    ADD COLUMN `proofFileObjectId` VARCHAR(191) NULL,
    ADD COLUMN `proofSha256` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `withdrawals_withdrawalNo_key` ON `withdrawals`(`withdrawalNo`);
CREATE UNIQUE INDEX `withdrawals_referenceCode_key` ON `withdrawals`(`referenceCode`);
CREATE UNIQUE INDEX `withdrawals_transactionRef_key` ON `withdrawals`(`transactionRef`);
CREATE INDEX `withdrawals_status_createdAt_idx` ON `withdrawals`(`status`, `createdAt`);
CREATE INDEX `withdrawals_proofFileObjectId_idx` ON `withdrawals`(`proofFileObjectId`);

ALTER TABLE `withdrawals`
    ADD CONSTRAINT `withdrawals_proofFileObjectId_fkey`
    FOREIGN KEY (`proofFileObjectId`) REFERENCES `files`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Paid withdrawals must carry the manual transfer reference and time. The
-- proof column is a foreign key, which MySQL forbids inside a CHECK, so a
-- trigger below enforces the proof instead.
ALTER TABLE `withdrawals`
    ADD CONSTRAINT `cvc_chk_withdrawals_paid_ref`
    CHECK (`status` <> 'COMPLETED' OR (`transactionRef` IS NOT NULL AND `paidAt` IS NOT NULL));

CREATE TRIGGER `withdrawals_paid_proof_before_insert` BEFORE INSERT ON `withdrawals` FOR EACH ROW
BEGIN
  IF NEW.status = 'COMPLETED' AND NEW.proofFileObjectId IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'WITHDRAWAL_PROOF_REQUIRED';
  END IF;
END;

CREATE TRIGGER `withdrawals_paid_proof_before_update` BEFORE UPDATE ON `withdrawals` FOR EACH ROW
BEGIN
  IF NEW.status = 'COMPLETED' AND NEW.proofFileObjectId IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'WITHDRAWAL_PROOF_REQUIRED';
  END IF;
END;
