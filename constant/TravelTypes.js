// The travel_type codes an F record can carry. Numbers on the wire, compared case
// insensitively in Java because they arrive as strings.
module.exports = {
    TRIP_STARTED: '0',
    TRIP_END: '1',
    VALAPP_STARTED: '2',
    DRIVERCARD_INSERTED: '3',
    DRIVERCARD_REMOVED: '4',
    DUTY_ENDED: '5',
    JOURNEY_STARTED: '6',
    STOP_ENTERED: '8',
    STOP_LEFT: '9',
    DRIVER_CHANGED: '11',
};
