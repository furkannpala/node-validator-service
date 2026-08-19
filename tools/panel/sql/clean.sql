-- Clears everything the comparison and load runs write, so a session starts from a known
-- state. Only the rows those tools produce: the reference data seed-testdata.sql inserts and
-- the KKCONFIG rows stay.
--
-- DESTRUCTIVE, and deliberately not keyed to one bus: a load run leaves rows behind under
-- whatever sequence it reached. Point this at a local test schema only.

DELETE FROM afc_td            WHERE sam_id = '05100077';
DELETE FROM afc_bl_td         WHERE sam_id = '05100077';
DELETE FROM afc_td_test       WHERE sam_id = '05100077';
DELETE FROM afc_td_nonverified WHERE sam_id = '05100077';
DELETE FROM afc_td_emv        WHERE sam_id = '05100077';
DELETE FROM afc_tf            WHERE sam_id = '05100077';
DELETE FROM afc_tf_event      WHERE sam_id = '05100077';
DELETE FROM afc_th            WHERE sam_id = '05100077';
DELETE FROM afc_station       WHERE sam_id = '05100077';
DELETE FROM tms_val_route     WHERE sam_id = '05100077';
DELETE FROM tms_door_status   WHERE sam_id = '05100077';

DELETE FROM tms_gps           WHERE bus_id = '00001';
DELETE FROM tms_apc           WHERE bus_id = '00001';
DELETE FROM tms_apc_event     WHERE bus_id = '00001';
DELETE FROM can_data          WHERE bus_id = '00001';
DELETE FROM afc_can           WHERE hostname = '00001';

DELETE FROM tbl_device_cfg    WHERE device_id IN ('00001', '00002');
DELETE FROM tbl_device_health WHERE device_id IN ('00001', '00002');
DELETE FROM tbl_device_log    WHERE device_id IN ('00001', '00002');

DELETE FROM tbl_validator_error_td WHERE bus_id IN ('00001', '00002');
DELETE FROM validator_request_log  WHERE bus_id IN ('00001', '00002');

COMMIT;
