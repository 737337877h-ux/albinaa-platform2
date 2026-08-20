ALTER TABLE oracle_movement_exception_reviews
  DROP CONSTRAINT ck_oracle_movement_exception_reviews_decision;

ALTER TABLE oracle_movement_exception_reviews
  ADD CONSTRAINT ck_oracle_movement_exception_reviews_decision CHECK (
    decision IN (
      'keep_excluded',
      'adopt_oracle_amount',
      'publish_inventory_snapshot_and_retry',
      'publish_verified_historical_collection',
      'reassign_historical_invoice'
    )
  );
