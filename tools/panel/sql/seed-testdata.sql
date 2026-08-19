-- One bus for the write-path comparison. BUS_ID is CHAR(5), so the id has to fit that.
-- station_type 1 puts it on the bus branch of senddata (ins_data), not the station one.
MERGE INTO mst_bus t
USING (SELECT '00001' AS bus_id FROM dual) s ON (t.bus_id = s.bus_id)
WHEN NOT MATCHED THEN INSERT (bus_id, comp_code, car_no, depot_code, station_type,
                              validity_start_date, validity_end_date)
     VALUES ('00001', 1, 'TEST-01', 'DEP0001', '1',
             DATE '2000-01-01', DATE '2099-12-31');
COMMIT;
-- A station for the ins_station branch (station_type other than 1 and 5), and a driver so
-- verifydriver and setdriverpassword reach their real work.
MERGE INTO mst_bus t USING (SELECT '00002' AS bus_id FROM dual) s ON (t.bus_id = s.bus_id)
WHEN NOT MATCHED THEN INSERT (bus_id, comp_code, car_no, depot_code, station_type,
                              validity_start_date, validity_end_date)
     VALUES ('00002', 1, 'TEST-ST', 'DEP0001', '2', DATE '2000-01-01', DATE '2099-12-31');
COMMIT;
-- One driver so verifydriver reaches the PIN comparison instead of the not-found branch.
-- DRIVER_CODE is CHAR(5); the queries compare it with LPAD(TRIM(...),5,'0').
MERGE INTO mst_personel t USING (SELECT 'D0001' AS driver_code FROM dual) s
  ON (t.driver_code = s.driver_code)
WHEN NOT MATCHED THEN INSERT (driver_code, name, comp_code, depot_code, pin,
                              validity_start_date, validity_end_date)
     VALUES ('D0001', 'TEST SURUCU', 1, 'DEP0001', 1234, DATE '2000-01-01', DATE '2099-12-31');
COMMIT;
