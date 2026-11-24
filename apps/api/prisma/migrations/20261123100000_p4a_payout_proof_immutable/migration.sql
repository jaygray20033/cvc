-- P4.20 DoD: the proof of a supplier transfer is immutable once written. Like
-- the ledger rows, UPDATE/DELETE is blocked unless the maintenance unlock
-- variable is set for the current session (test cleanup only).
CREATE TRIGGER `payout_proofs_no_update` BEFORE UPDATE ON `payout_proofs` FOR EACH ROW
BEGIN
  IF @cvc_ledger_unlocked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYOUT_PROOF_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `payout_proofs_no_delete` BEFORE DELETE ON `payout_proofs` FOR EACH ROW
BEGIN
  IF @cvc_ledger_unlocked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYOUT_PROOF_IMMUTABLE';
  END IF;
END;
