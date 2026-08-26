-- ProInspect Building Management - finalised monthly report immutability
--
-- Finalisation is a one-way workflow gate. Once a report is finalised its
-- snapshot and commentary must not be modified or deleted by a later API call,
-- accidental regeneration, or direct operational tooling.

CREATE TRIGGER IF NOT EXISTS trg_monthly_report_drafts_lock_update
BEFORE UPDATE ON monthly_report_drafts
WHEN OLD.status = 'finalised'
BEGIN
  SELECT RAISE(ABORT, 'FINALISED_REPORT_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_monthly_report_drafts_lock_delete
BEFORE DELETE ON monthly_report_drafts
WHEN OLD.status = 'finalised'
BEGIN
  SELECT RAISE(ABORT, 'FINALISED_REPORT_LOCKED');
END;
