-- Records the destination row/range identifier returned by a future connector.
ALTER TABLE integration_outbox ADD COLUMN external_reference TEXT;
