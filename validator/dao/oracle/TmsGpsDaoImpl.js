const BaseDao = require("../BaseDao");

const COLS = 'bus_id,date_time,latitude,nsindicator,longitude,ewindicator,altitude,speed,utctime,hdop,'
    + 'svcount,status,route_code,hpt,route_distance,route_offset,odometer,event,sub_event,driver_code,'
    + 'trip_no,path_code,total_fuel_used';
// path_code is truncated in SQL, not in JS, so the stored value stays byte identical to Java's.
const VALUES = ':bus_id,:date_time,:latitude,:nsindicator,:longitude,:ewindicator,:altitude,:speed,'
    + ':utctime,:hdop,:svcount,:status,:route_code,:hpt,:route_distance,:route_offset,:odometer,'
    + ':event,:sub_event,:driver_code,:trip_no,substr(:path_code,1,6),:total_fuel_used';

class TmsGpsDaoImpl extends BaseDao {

    insertSql = `INSERT INTO tms_gps(${COLS}) VALUES(${VALUES})`;

    /** Numeric conversions live on GpsTransaction, which keeps Java's grouped fallbacks. */
    toBind(trx, routeCode, pathCode) {
        const { lat, lng } = trx.getLatLng();
        const { mainevent, subevent } = trx.getEvents();
        const { hdop, svcount, utctime } = trx.getQuality();
        return {
            bus_id: trx.bus_id,
            date_time: trx.date_time,
            latitude: lat,
            nsindicator: trx.nsindicator,
            longitude: lng,
            ewindicator: trx.ewindicator,
            altitude: trx.altitude,
            speed: trx.getSpeedInt(),
            utctime,
            hdop,
            svcount,
            status: trx.status,
            route_code: routeCode,
            hpt: trx.hpt,
            route_distance: trx.getRouteDistanceInt(),
            route_offset: trx.getRouteOffsetInt(),
            odometer: trx.getOdometerInt(),
            event: mainevent,
            sub_event: subevent,
            driver_code: trx.driver_code,
            trip_no: trx.trip_no,
            path_code: pathCode,
            total_fuel_used: trx.total_fuel_used,
        };
    }

    insert(conn, trx, routeCode, pathCode, sessionId) {
        return this.exec(conn, this.insertSql, this.toBind(trx, routeCode, pathCode), sessionId);
    }
}

module.exports = new TmsGpsDaoImpl();
