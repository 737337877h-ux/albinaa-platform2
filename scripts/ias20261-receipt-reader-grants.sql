-- Run as IAS20261 owner or DBA on the Oracle database host.
-- Read-only grants required for receipt status listing and post-create readback.
GRANT SELECT ON IAS20261.IAS_RQ_VCHR_MST TO ALBINAA_RO;
GRANT SELECT ON IAS20261.IAS_RQ_VCHR_DTL TO ALBINAA_RO;
GRANT SELECT ON IAS20261.S_APPRVD_MOV TO ALBINAA_RO;
