/**
 * The request catalogue for the Java/Node comparison. One entry per ?func=, with parameters
 * that reach the endpoint's real work rather than its missing-parameter guard.
 *
 * `volatile` lists attributes whose value the services cannot agree on because the database or
 * the clock produces them at call time; the runner blanks those before comparing. `skip` marks
 * an endpoint that cannot be compared this way at all, with the reason.
 */

const BUS = '34AA0001';
const SAM = '05100001';
const FULL_VERSION = '19700101000000';

// Reads only. Nothing here writes a row, so a case can be replayed against both services.
const READ = [
    { func: 'synctime', query: {}, volatile: ['datetime'] },
    { func: 'getversion', query: {},
        skip: 'the two services report their own version, which is the point of the field' },
    { func: 'getstatistics', query: {},
        skip: 'a live counter: the two services have been up for different lengths of time' },
    { func: 'resetstatistics', query: {}, skip: 'clears the counter getstatistics reports' },

    { func: 'getcacheinfo', query: {},
        skip: 'reports this service own cache directory; Java has no equivalent endpoint' },
    { func: 'getavlrules', query: { busid: BUS } },

    // Single procedure returning a LOB.
    { func: 'getfile', query: { busid: BUS, filever: FULL_VERSION, fileid: '1', type: '1' } },
    { func: 'getfiles', query: { busid: BUS, filever: FULL_VERSION, type: '1', fileid: '1' } },
    { func: 'getblacklist', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getschedule', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getroute', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getpath', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getroutepath', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getpathstage', query: { busid: BUS } },
    { func: 'getvehiclestop', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getpathbusstop', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getrouteschedule', query: { busid: BUS, filever: FULL_VERSION, timeunit: '1' } },
    { func: 'getscheduleplan', query: { busid: BUS } },
    { func: 'getstage', query: { busid: BUS } },
    { func: 'gettriptype', query: { busid: BUS } },
    { func: 'getbusstop', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getroutebusstop', query: { busid: BUS, groupid: '1', version: FULL_VERSION, samid: SAM } },
    // Its own Java catch answers with the bare Integer.parseInt message and no XML.
    { func: 'getroutebusstop', name: 'getroutebusstop (groupid yok)', query: { busid: BUS } },
    { func: 'getbusroute', query: { busid: BUS } },
    { func: 'getvalidatorlist', query: { busid: BUS } },
    { func: 'getbusinfo', query: { busid: BUS } },
    { func: 'getmessageinfo', query: { busid: BUS } },
    { func: 'getroutecoordinate', query: { busid: BUS } },
    { func: 'getreport', query: { busid: BUS, samid: SAM } },
    { func: 'getreportinterval', query: { busid: BUS, samid: SAM } },
    { func: 'getdriverpassword', query: { busid: BUS, driverid: 'D1' } },
    { func: 'getcarddetail', query: { aliasno: '99999999', counter: '1' } },
    { func: 'getdriverworkhours', query: { busid: BUS }, volatile: ['CREATE_DATE_TIME'] },
    { func: 'getvalcfg', query: { busid: BUS } },
    { func: 'getzone', query: { busid: BUS } },
    { func: 'getafcodmatrix', query: { busid: BUS } },
    { func: 'getafczonegroup', query: { busid: BUS } },
    { func: 'getafcfares', query: { busid: BUS } },
    { func: 'getafcproduct', query: { busid: BUS } },
    { func: 'getmstproducttype', query: { busid: BUS } },

    // Reports and plans.
    { func: 'getbusrouteplan', query: { busid: BUS } },
    { func: 'getusagesummary', query: { busid: BUS, samid: SAM } },
    { func: 'getdriverplan', query: { busid: BUS } },
    { func: 'getbusparkplace', query: { busid: BUS } },
    { func: 'getruninprogressreport', query: { busid: BUS } },
    { func: 'getdutyschedule', query: { busid: BUS } },

    // Cards and fares that only read.
    { func: "getcardinfo", query: { card_no: "01712340000001" } },
    { func: 'getofflinecardlist', query: { busid: BUS, filever: FULL_VERSION } },
    { func: 'getuncalculatedtransaction', query: { busid: BUS, cardtype: '09' } },

    { func: 'yokboyle', name: 'unrecognised func', query: {} },
];

module.exports = { READ, BUS, SAM, FULL_VERSION };
