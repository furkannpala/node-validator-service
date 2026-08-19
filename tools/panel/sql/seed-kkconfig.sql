-- KKCONFIG.VALIDATOR_SERVICE_CONFIG seed, transcribed from
-- ValidatorServices-master/WebContent/WEB-INF/classes/env.properties
-- Key mapping follows VALIDATOR-NODE-MIGRATION-ROADMAP.md section 7.4.
--
-- Values are typed the way the sibling config tables type them (numbers and booleans
-- unquoted, csv lists as strings). Java read every value as a String and coerced it at
-- use, so both shapes behave the same on the Node side.
--
-- Commented-out keys in env.properties (kafka_producer_retries,
-- kafka_producer_max_block_ms, kpg_connect_timeout_ms, kpg_read_timeout_ms) are left out
-- on purpose: absent means the code default applies, which is what Java did with them.
--
-- Run as the KKCONFIG owner. MERGE, so re-running only refreshes the rows.

SET DEFINE OFF

MERGE INTO validator_service_config t
USING (SELECT 'app' AS system_id FROM dual) s ON (t.system_id = s.system_id)
WHEN MATCHED THEN UPDATE SET config = '{
      "card_type_check":"31,02","currency_multiplier":100,
      "credit_card_data_url":"http://10.0.40.213:8888/KentkartPaymentGateway/Ops?func=",
      "credit_card_auth_url":"http://10.0.40.213:8888/KentkartPaymentGateway/Ops?func=",
      "sp_create_offline_recharge_xml_includes_provno":true,
      "credit_card_type":"11"
    }'
WHEN NOT MATCHED THEN INSERT (system_id, config) VALUES ('app', '{
      "card_type_check":"31,02","currency_multiplier":100,
      "credit_card_data_url":"http://10.0.40.213:8888/KentkartPaymentGateway/Ops?func=",
      "credit_card_auth_url":"http://10.0.40.213:8888/KentkartPaymentGateway/Ops?func=",
      "sp_create_offline_recharge_xml_includes_provno":true,
      "credit_card_type":"11"
    }');

-- The only section that turns the producer on. An empty value in env.properties reached
-- Boolean.parseBoolean as false, so the two blank flags are stored as false.
MERGE INTO validator_service_config t
USING (SELECT '028' AS system_id FROM dual) s ON (t.system_id = s.system_id)
WHEN MATCHED THEN UPDATE SET config = '{
      "senddata_topic":"afctd028","kk_bootstrap_servers":"10.0.40.56:9092",
      "datasource_prefix":"","senddata_use_kafka_producer":true,
      "senddata_use_only_kafka_produce":false,"senddata_kafka_error_throw":false
    }'
WHEN NOT MATCHED THEN INSERT (system_id, config) VALUES ('028', '{
      "senddata_topic":"afctd028","kk_bootstrap_servers":"10.0.40.56:9092",
      "datasource_prefix":"","senddata_use_kafka_producer":true,
      "senddata_use_only_kafka_produce":false,"senddata_kafka_error_throw":false
    }');

-- The one system whose pool alias is prefixed: jdbc/dbValidator026 rather than jdbc/db026.
MERGE INTO validator_service_config t
USING (SELECT '026' AS system_id FROM dual) s ON (t.system_id = s.system_id)
WHEN MATCHED THEN UPDATE SET config = '{
      "datasource_prefix":"Validator",
      "sp_create_offline_recharge_xml_includes_provno":false,
      "getbusrouteplan_driverid_query":true
    }'
WHEN NOT MATCHED THEN INSERT (system_id, config) VALUES ('026', '{
      "datasource_prefix":"Validator",
      "sp_create_offline_recharge_xml_includes_provno":false,
      "getbusrouteplan_driverid_query":true
    }');

MERGE INTO validator_service_config t
USING (SELECT '004' AS system_id FROM dual) s ON (t.system_id = s.system_id)
WHEN MATCHED THEN UPDATE SET config = '{"save_extended_fare":true}'
WHEN NOT MATCHED THEN INSERT (system_id, config)
     VALUES ('004', '{"save_extended_fare":true}');

MERGE INTO validator_service_config t
USING (SELECT '017' AS system_id FROM dual) s ON (t.system_id = s.system_id)
WHEN MATCHED THEN UPDATE SET config = '{
      "sp_create_offline_recharge_xml_includes_provno":false,
      "getbusrouteplan_compcode_query":true
    }'
WHEN NOT MATCHED THEN INSERT (system_id, config) VALUES ('017', '{
      "sp_create_offline_recharge_xml_includes_provno":false,
      "getbusrouteplan_compcode_query":true
    }');

-- Every remaining section carries the same single key.
BEGIN
    FOR s IN (
        SELECT COLUMN_VALUE AS system_id FROM TABLE(sys.odcivarchar2list(
            '008','011','013','014','018','020','023','024','025','027','029','030','109'))
    ) LOOP
        MERGE INTO validator_service_config t
        USING (SELECT s.system_id AS system_id FROM dual) x ON (t.system_id = x.system_id)
        WHEN MATCHED THEN UPDATE SET
            config = '{"sp_create_offline_recharge_xml_includes_provno":false}'
        WHEN NOT MATCHED THEN INSERT (system_id, config)
            VALUES (s.system_id, '{"sp_create_offline_recharge_xml_includes_provno":false}');
    END LOOP;
END;
/

COMMIT;
