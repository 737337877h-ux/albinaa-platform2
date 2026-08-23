\set ON_ERROR_STOP on

-- Batch A verification runs only against an isolated test database.
-- All fixture writes are rolled back at the end.
BEGIN;

DO $$
DECLARE
  org_id UUID := gen_random_uuid();
  other_org_id UUID := gen_random_uuid();
  branch_id UUID := gen_random_uuid();
  other_branch_id UUID := gen_random_uuid();
  published_run_id UUID := gen_random_uuid();
  unpublished_run_id UUID := gen_random_uuid();
  zero_hash TEXT := repeat('0', 64);
  visible_rows INTEGER;
BEGIN
  INSERT INTO organizations (id, name)
  VALUES (org_id, 'Oracle mirror batch A test'),
         (other_org_id, 'Oracle mirror other organization');

  INSERT INTO branches (id, organization_id, name)
  VALUES (branch_id, org_id, 'Oracle mirror test branch'),
         (other_branch_id, other_org_id, 'Oracle mirror other branch');

  INSERT INTO oracle_inventory_sync_runs (
    id, organization_id, source_schema, status, validated_at, published_at,
    manifest_hash
  ) VALUES (
    published_run_id, org_id, 'IAS_TEST', 'published', CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP, zero_hash
  );

  INSERT INTO oracle_item_groups_mirror (
    sync_run_id, organization_id, external_group_code, name_ar, source_hash
  ) VALUES (published_run_id, org_id, '001', 'مجموعة اختبار', zero_hash);

  INSERT INTO oracle_items_mirror (
    sync_run_id, organization_id, external_item_code, name_ar,
    external_group_code, source_hash
  ) VALUES (published_run_id, org_id, 'ITEM-1', 'صنف اختبار', '001', zero_hash),
           (published_run_id, org_id, 'ITEM-2', 'صنف اختبار ثان', '001', zero_hash);

  INSERT INTO oracle_item_units_mirror (
    sync_run_id, organization_id, external_item_code, unit_name, package_size,
    is_main_unit, is_sale_unit, barcode, source_hash
  ) VALUES (
    published_run_id, org_id, 'ITEM-1', 'حبة', 1, true, true,
    'TEST-BARCODE', zero_hash
  );

  INSERT INTO oracle_warehouse_groups_mirror (
    sync_run_id, organization_id, external_group_code, name_ar, source_hash
  ) VALUES (published_run_id, org_id, '1', 'مجموعة مستودعات اختبار', zero_hash);

  INSERT INTO oracle_warehouses_mirror (
    sync_run_id, organization_id, external_warehouse_code, name_ar,
    external_group_code, external_branch_code, source_hash
  ) VALUES (
    published_run_id, org_id, '101', 'مستودع اختبار', '1', '1', zero_hash
  );

  INSERT INTO oracle_stock_balances_mirror (
    sync_run_id, organization_id, external_item_code, unit_name, package_size,
    external_warehouse_code, external_warehouse_group_code,
    warehouse_group_key, available_quantity, source_hash
  ) VALUES (
    published_run_id, org_id, 'ITEM-1', 'حبة', 1, '101', '1', '1', 25,
    zero_hash
  );

  INSERT INTO oracle_inventory_active_snapshots (
    organization_id, source_schema, active_run_id
  ) VALUES (org_id, 'IAS_TEST', published_run_id);

  SET CONSTRAINTS "trg_oracle_active_snapshot_valid" IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  SELECT COUNT(*) INTO visible_rows
  FROM current_oracle_stock_balances
  WHERE organization_id = org_id;

  IF visible_rows <> 1 THEN
    RAISE EXCEPTION 'Expected one row in current_oracle_stock_balances, got %', visible_rows;
  END IF;

  BEGIN
    INSERT INTO oracle_item_groups_mirror (
      sync_run_id, organization_id, external_group_code, name_ar, source_hash
    ) VALUES (published_run_id, other_org_id, '002', 'نطاق خاطئ', zero_hash);
    RAISE EXCEPTION 'Expected organization scope violation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'Expected organization scope violation' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO oracle_item_units_mirror (
      sync_run_id, organization_id, external_item_code, unit_name, package_size,
      barcode, source_hash
    ) VALUES (
      published_run_id, org_id, 'ITEM-2', 'علبة', 2, 'TEST-BARCODE', zero_hash
    );
    RAISE EXCEPTION 'Expected duplicate barcode violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO oracle_item_units_mirror (
      sync_run_id, organization_id, external_item_code, unit_name, package_size,
      source_hash
    ) VALUES (published_run_id, org_id, 'ITEM-2', 'كرتون', 0, zero_hash);
    RAISE EXCEPTION 'Expected package size check violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE oracle_items_mirror
    SET name_ar = 'تعديل غير مسموح'
    WHERE sync_run_id = published_run_id AND external_item_code = 'ITEM-1';
    RAISE EXCEPTION 'Expected append-only violation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'Expected append-only violation' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO oracle_branch_mappings (
      organization_id, source_schema, external_branch_code, platform_branch_id
    ) VALUES (org_id, 'IAS_TEST', '2', other_branch_id);
    RAISE EXCEPTION 'Expected branch organization scope violation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'Expected branch organization scope violation' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO oracle_inventory_sync_runs (
    id, organization_id, source_schema, status
  ) VALUES (unpublished_run_id, org_id, 'IAS_UNPUBLISHED', 'validating');

  BEGIN
    INSERT INTO oracle_inventory_active_snapshots (
      organization_id, source_schema, active_run_id
    ) VALUES (org_id, 'IAS_UNPUBLISHED', unpublished_run_id);
    SET CONSTRAINTS "trg_oracle_active_snapshot_valid" IMMEDIATE;
    RAISE EXCEPTION 'Expected unpublished snapshot violation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'Expected unpublished snapshot violation' THEN
        RAISE;
      END IF;
  END;

  SET CONSTRAINTS ALL DEFERRED;
  RAISE NOTICE 'Oracle inventory mirror Batch A verification passed';
END;
$$;

ROLLBACK;
