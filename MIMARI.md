# Validator Service — Uçtan Uca

Bu doküman servisi baştan sona anlatır: otobüse binen şoförden başlayıp, kartını okutan
yolcunun kaydının Oracle'a düşmesine ve oradan sonra kimin devraldığına kadar. Sonra aynı
zinciri kodun içinde takip eder — hangi dosya, hangi metot, hangi sırayla. En sonda hata
ararken nereden başlanacağı var.

Kaynak: 111 dosya / ~9.400 satır, 65 endpoint, 45 Oracle DAO, 10 SQLite DAO, 2 job, 358 test.

---

## İçindekiler

1. [Servis tek cümlede](#1-servis-tek-cümlede)
2. [Fiziksel zincir — sahada ne oluyor](#2-fiziksel-zincir--sahada-ne-oluyor)
3. [Bir isteğin kod içindeki yolculuğu](#3-bir-isteğin-kod-içindeki-yolculuğu)
4. [`senddata` — tam iz sürme](#4-senddata--tam-iz-sürme)
5. [Katman katman dosya referansı](#5-katman-katman-dosya-referansı)
6. [Veri nereye yazılıyor](#6-veri-nereye-yazılıyor)
7. [Validator Service'in işi nerede bitiyor](#7-validator-servicein-işi-nerede-bitiyor)
8. [Debug rehberi](#8-debug-rehberi)
9. [Yapılandırma](#9-yapılandırma)

---

## 1. Servis tek cümlede

**Otobüs ve istasyonlardaki bilet doğrulama cihazlarının (validator) konuştuğu HTTP servisi.**
Cihazlar buradan çalışmak için ihtiyaç duydukları veriyi indirir (güzergah, durak, kara liste,
tarife), ve topladıkları veriyi buraya yükler (biletler, seferler, konum, cihaz sağlığı).

Java'da `ValidatorServices` (WAR, v5.92.0) idi; bu onun Node karşılığı. Tek bir HTTP ucu var
ve ne yapılacağı `?func=` parametresiyle seçiliyor:

```
GET|POST  /Validator Services/Validator?func=<isim>&systemid=017&busid=34AA0001&...
```

`systemid` hangi şehir/işletme olduğunu söyler ve hangi Oracle havuzuna gidileceğini belirler.

---

## 2. Fiziksel zincir — sahada ne oluyor

### 2.1 Şoför otobüse biniyor, vardiya açılıyor

Şoför sürücü kartını cihaza takar. Cihaz sırayla şunları sorar:

| Adım | `?func=` | Ne olur |
|---|---|---|
| Şoför kim, şifresi doğru mu | `verifydriver` | `MST_PERSONEL`'den PIN okunur. Ayrıca **aynı şoförün başka bir otobüste açık vardiyası var mı** diye `AFC_TH` kontrol edilir; varsa `-2001` döner ve cihaz vardiyayı açmaz |
| Şoförün şifresi | `getdriverpassword` / `setdriverpassword` | `pk_app_val` prosedürleri |
| Bugün hangi hatta çalışacak | `getbusrouteplan` | `DAILY_BUS_ROUTE`; `ROUTE_CODE="-1"` gelirse "tüm hatları göster" demektir |
| Vardiya planı | `getdriverplan`, `getdutyschedule`, `getdriverworkhours` | `pk_rep` / `pk_app_val` raporları |

Kart takma anı ayrıca bir **F kaydı** olarak (`travel_type=3`, DRIVERCARD_INSERTED) daha sonra
`senddata` ile yüklenir ve `AFC_TH` vardiya tablosuna yazılır.

### 2.2 Cihaz kendini hazırlıyor

Cihaz açılışta kendi kimliğini bildirir ve çalışmak için gereken veriyi indirir:

```
sendcfg          cihazin kendi konfigurasyonu + saglik verisi  -> TBL_DEVICE_CFG, TBL_DEVICE_HEALTH
getvalcfg        sunucunun cihaza verdigi ayarlar
getversion       servis surumu
synctime         sunucu saati  (cihaz saatini buna gore kurar)
```

Sonra iş verisi:

```
getroute         hatlar
getpath          guzergahlar
getbusstop       duraklar
getroutebusstop  hangi hatta hangi duraklar, hangi sirayla
getrouteschedule sefer saatleri
getblacklist     kara listedeki kartlar
getofflinecardlist  cevrimdisi kart listesi
getafcfares      tarife
getfiles         durak anons ses dosyalari  (BLOB)
getrouteinfodb   yukaridakilerin cogunun tek bir SQLite .db dosyasi hali
```

Bu belgelerin **sekizi diskte cache'lenir** (`validatorCacheFiles/`). Aynı gün aynı sürümü
isteyen ikinci cihaz Oracle'a hiç gitmez, dosyayı okur. Cache günlük — operasyon günü dönünce
tüm ağaç silinir. Bir dosya üretilirken ikinci bir istek gelirse `-20095 File Not Ready` alır
ve biraz sonra tekrar dener.

`getrouteinfodb` özel: Oracle'dan dört tablo okunup **cihaz için bir SQLite dosyası üretilir**
(9 tablo yazılır) ve o dosya cevap olarak gönderilir. Pahalı bir iştir; `?cache=1`
açıksa dosya önceden hazırlanır.

### 2.3 Sefer başlıyor

Şoför seferi başlatır. Cihaz bunu bir **F kaydı** olarak üretir (`record_id` "F" ile başlar,
`travel_type=0` TRIP_STARTED). Bu kayıt da anında gönderilmez, cihazda birikir.

### 2.4 Yolcu kart okutuyor — **burada sunucu yok**

Bu en önemli nokta: **kart okutulduğu anda bu servis çalışmıyor.**

Cihaz kendi başına karar verir:
- Kart kara listede mi (indirdiği listeden bakar),
- Ücret ne kadar (indirdiği tarifeden hesaplar),
- Bakiye yeter mi,
- Bipler, kapıyı açar.

Otobüs tünelde de olsa çalışmak zorunda olduğu için hepsi çevrimdışıdır. Cihaz sonucu
**kendi belleğinde bir D kaydı** olarak saklar (`record_id` "D" ile başlar).

Kredi kartı (EMV) için iki mod var: cihaz ücreti kendi hesaplar (`key_index=1`), ya da
hesaplamayı sunucuya bırakır — o zaman kayıt `transfer_ref_code='sync'` ile işaretlenir ve
sonradan koşan fiyatlama işi onu görüp fiyatlar.

### 2.5 Cihaz biriktirdiğini yüklüyor — `senddata`

Ağ bulduğunda cihaz biriktirdiği kayıtları **toplu** gönderir:

```xml
POST ?func=senddata&busid=34AA0001&stationtype=1&systemid=017

<TD>
  <DATA record_id="F0001" travel_type="0" ht_start_time="20260818080000" .../>
  <DATA record_id="D0001" card_no="01712340000001" usage_amt="250"
        remained_amt="1000" date_time="20260818101500" trans_flag="1"
        usage_cnt="3" transmit_cnt="1" sam_id="05100001" .../>
  <DATA record_id="D0002" .../>
</TD>
```

- `usage_amt="250"` → cihazın kestiği ücret (kuruş). Biz `currency_multiplier`'a böleriz → **2.50**
- `remained_amt` → işlemden sonraki bakiye
- `transmit_cnt` → cihazın kaçıncı gönderme denemesi. **Aynı paket tekrar gelebilir**, o yüzden
  duplicate insert'ler sessizce yutulur (ORA-00001)

Servis her `<DATA>` için ayrı transaction açar: bir bozuk kayıt iyileri geri almaz.

### 2.6 Konum ve telemetri

Sefer boyunca ayrıca:

```
sendgps      GPSDAT (konum) ve CANDAT (arac veri yolu: yakit, kapi, yolcu sayaci)
onlinegps    anlik konum
wlanstatus   ag durumu
sendlog      cihaz log kayitlari
sendcan      CAN verisi
sendalarm    alarm  (ayrica XML-RPC ile cihaza mesaj gonderebilir)
```

`sendgps`'te bir güvenlik kuralı var: cihazın saati **12 saatten fazla ileriyse** o konum
kaydı atılır — saati bozuk cihaz kabul edilir.

### 2.7 Sefer bitiyor, vardiya kapanıyor

Sefer sonu (`travel_type=1`), sürücü kartı çıkışı (`4`), vardiya sonu (`5`) — hepsi F kaydı
olarak yüklenir ve `AFC_TF` / `AFC_TH` tablolarını günceller.

---

## 3. Bir isteğin kod içindeki yolculuğu

### 3.1 Servis nasıl ayağa kalkıyor

```
server.js:13   const services = require('./webapps')
                 └─> webapps/index.js her webapp klasorunu require eder
                       └─> node-validator-service/index.js CALISIR
                             - validator ve management route'larini export eder
                             - setImmediate ile jobs.init() planlar
server.js:112  await initPools(cfg)          Oracle havuzlari kurulur (017, kkconfig)
server.js:116  registerWebapp(...)           route'lar express'e baglanir
```

`index.js`'teki `setImmediate` havuzlardan **önce** ateşlenir. Bu yüzden `JobManager` config
havuzunun (`kkconfig`) belirmesini bekler (`waitForConfigPool`) — beklemezse config tablosunu
yanlış havuzdan okuma riski vardı.

Route'lar `lib/console.js:39`'da kurulur:

```
/Validator Services/Validator    -> validator/index.js
/Validator Services/Admin        -> management/index.js
```

`validator/index.js` `conn: true` der; bu yüzden framework her isteğe bir middleware zinciri
kurar:

```
setSystemId  -> res.locals.systemId  (?systemid)
setSessionId -> req.sessionId        (tum loglarda bu var)
getPoolConn  -> req.dbConn           CONNECTION ACILIR  (lib/utils.js:345)
element.func -> validator/index.js   ISIN YAPILDIGI YER
releasePoolConn                      CONNECTION KAPANIR (lib/utils.js:492)
```

Connection'ı **framework açar ve kapatır**, hata yolunda bile (`globalErrHandler`
`releasePoolConn`'u çağırır). Webapp içinde connection açan yalnızca iki yer var: job'lar
(`JobManager.withConnection`) ve config yükleme (`ConfigDaoImpl`) — ikisinin de miras alacağı
bir istek yok.

### 3.2 Dispatcher — `validator/index.js`

```
1. func = req.query.func.toLowerCase()
2. RequestStats.add(...)              sayaci artir  (?func=getstatistics bunu raporlar)
3. controller[func] var mi?           yoksa -9 unrecognized func
4. req.cfg = systemViewFor(systemId).cfg KKCONFIG'in bellekteki kopyasi
5. save_request_log_functions listesindeyse gövdeyi VALIDATOR_REQUEST_LOG'a yaz
6. Bu func cache'lenir mi?
      hayir -> controller'i cagir, bitti
      evet  -> dosya var mi?
                 var  -> diskten oku, gonder
                 yok  -> baskasi uretiyor mu? -> evet ise -20095
                         hayir ise uret, dogrula, diske yaz, gonder
```

**Controller kaydı:** her controller dosyası bir `funcs` tablosu export eder ve anahtarları
`?func=` değerleridir. İki dosya aynı anahtarı sahiplenirse **açılışta hata fırlatılır** —
sessizce birbirini gölgelemesindense.

### 3.3 Controller kalıbı

Her endpoint aynı şekle sahiptir:

```js
async func(req, res, next) {
    let respErr;
    try {
        await this.setValidatorStatus(req, " GetPath  ", ` busid:${req.query.busid}`);
        const data = await this.daoImpl.getPath(req.dbConn, { ... }, req.sessionId);
        res.setHeader("Content-Type", "text/xml");
        res.locals.data = data;
    } catch (error) {
        respErr = this.getServiceError(error, req);
    } finally {
        next(respErr);          // her zaman tam bir kez
    }
}
```

`setValidatorStatus` her endpoint'in ilk işidir: `pk_app_val.sp_setval_status` çağırıp
"bu cihaz şu an şunu yapıyor" bilgisini yazar. Java'da 50+ endpoint bunu yapıyordu, aynen
korundu.

---

## 4. `senddata` — tam iz sürme

Servisin en ağır yazma yolu. Adım adım:

```
validator/index.js
  └─ controller/transaction.js  SendData.func()
       ├─ setValidatorStatus(" SendData ")                    pk_app_val.sp_setval_status
       ├─ process(req) ─> store(req, res)
       │    ├─ senddataConfig()      currency_multiplier, kart tipleri, kafka anahtarlari
       │    ├─ bodyElements(req)     util/XmlWalk.elements()  -> XML'i duz listeye cevirir
       │    │                        (parse edilemezse: TBL_VALIDATOR_ERROR_TD'ye yaz, OK don)
       │    ├─ mstBus.checkStation() bu bus_id + station_type MST_BUS'ta var mi?  yoksa hata
       │    ├─ selectStrategy()      otobus / istasyon / tchew
       │    └─ her <DATA> icin:
       │         ├─ trx.resetPerElement()      onceki kayittan sizmamasi gereken alanlari temizle
       │         ├─ trx.applyEmvAttrs(...)     EMV alt elemani (varsa)
       │         ├─ trx.applyAttrs(...)        DATA attribute'lari -> alan adlari
       │         ├─ kafka acikas produceKafka()
       │         └─ storeRecord() -> withTransaction(conn):
       │                strategy.processTransaction()   ← TABLO KARARI BURADA
       ├─ sendEmvUsages()      kredi karti kullanimlarini odeme gecidine tek belgede POST et
       └─ forwardToTicketEngine()   ham govdeyi ticket engine'e ilet (URL PK_CONFIG'den)
```

### 4.1 Strateji seçimi (istek başına bir kez)

```
station_type 1 veya 5 degil ......  StationStrategy      (Java ins_station)
systemId 106 + comp_code != 1 ....  TchewDataStrategy    (Java ins_data_tchew)
diger ............................  DataStrategy         (Java ins_data)
```

### 4.2 Kayıt tipi (her kayıt için)

`record_id`'nin ilk harfi:

```
DataStrategy
├─ 'F' + station_type 1|5 → FRecordStrategy   sefer kaydi
├─ 'D'                    → DRecordStrategy   bilet
└─ diger                  → AFC_BL_TD         siniflandirilamayan
```

### 4.3 Bir D kaydı (bilet) — `DRecordStrategy.processTransaction`

```
1. ensureTrip()      biletin tf_id'si bir sefer satirini gosterir. Bilet, seferi acan
                     kayittan ONCE gelebilir -> travel_type 0 ile yer tutucu sefer acilir
2. normalize()       tutarlar / currency_multiplier
                     yolcu sayisi (yoksa 1; sistem 004'te bazi flag'lerde 0 kalir)
                     iptal (trans_flag 4) -> sayi ve tutar NEGATIFE cevrilir
                     koordinat okunur (biri bozuksa ikisi de 0)
3. isVerified()      yalniz sistem 112 kayitlarini imzalar (ECDSA, util/EccDsaVerify)
4. Tablo karari:
     test karti (card_type_check)      -> AFC_TD_TEST
     trans_flag 2 veya 0 (kara liste)  -> AFC_BL_TD
     diger:
       storeEmv()          ptcn varsa -> AFC_TD_EMV
       transferRefCode()   kredi karti + cihaz fiyatlamadiysa -> 'sync'
       imza tutmadi        -> AFC_TD_NONVERIFIED
       imza tuttu          -> AFC_TD  (only_tap degilse) + TBL_RFCARD.csn guncelle
5. collectEmvUsage() kredi karti kullanimini gecide gidecek pakete ekle
```

**Tek bir D kaydı, tek transaction içinde altı ayrı DAO'ya dokunur:** `AfcTfDaoImpl`,
`MstBusDaoImpl`, `AfcTdEmvDaoImpl`, `AfcTdDaoImpl`, `TblRfcardDaoImpl`, `PkConfigDaoImpl`.
Hepsi birlikte commit olur ya da birlikte geri alınır — bu yüzden connection dışarıdan
verilir, her DAO kendi connection'ını açsa ortak transaction diye bir şey kalmazdı.

### 4.4 Bir F kaydı (sefer) — `FRecordStrategy` + `TravelTypeVisitor`

`travel_type` hangi visitor metotlarının koşacağını belirler, **birden fazlası koşabilir**:

| travel_type | anlamı | koşan visitor metotları |
|---|---|---|
| 0 | sefer başladı | visitDefault, visitWithoutStop, visitTripStarted |
| 1 | sefer bitti | visitDefault, visitWithoutStop, visitTripEnd |
| 2 | uygulama açıldı | visitWithoutStop |
| 3 / 4 / 5 | sürücü kartı takıldı / çıkarıldı / vardiya bitti | visitWithoutStop, visitDrivercard |
| 6 | yolculuk başladı | visitDefault, visitWithoutStop, visitJourneyStarted |
| 8 / 9 | durağa girdi / çıktı | visitStopEntered / visitStopLeft |
| 11 | sürücü değişti | visitDefault, visitWithoutStop, visitDriverChanged |

- `visitDefault` → şirket/depo bulur, kilometre ve durak sayısını hesaplar
- `visitWithoutStop` → `AFC_TF_EVENT`'e olay satırı yazar
- `visitTripOpen/End/Time/DriverChange` → `AFC_TF` sefer satırını MERGE eder
- `visitDrivercard` → `AFC_TH` vardiya satırını MERGE eder
- `visitStopEntered/Left` → `TMS_VAL_ROUTE`

---

## 5. Katman katman dosya referansı

### 5.1 Giriş ve yapılandırma

| Dosya | İçerik |
|---|---|
| `index.js` | Webapp sözleşmesi. `[validator, management]` export eder. `VS_AUTOSTART!=0` ise `setImmediate` ile `JobManager.init()` planlar; SIGINT/SIGTERM'de Kafka producer'larını kapatır. **Çok süreçli kurulumda yalnız bir süreç job çalıştırmalı** (`VS_AUTOSTART=0`) |
| `version.js` | Sürüm dizesi |
| `config/system_cfg.js` | `context` (route prefix `Validator Services`), `kk_config_scheme`, KKCONFIG'in bellekteki kopyası (`cfgs`), `getSystemConfig(key, systemId, default)` (sistem satırı → `app` satırı → varsayılan), `setCfgs()` ve her yazımda artan `revision` |

### 5.2 Sabitler

| Dosya | İçerik |
|---|---|
| `constant/Constant.js` | `SQL_EXCEPTION_UNIQUE_INDEX=1`, `BUS_STATION_TYPES={1,5}`, `FORCED_UNIT_MULTIPLIER_SYSTEMS` (config ne derse desin çarpanı 1 olan sistemler), `DEFAULT_CURRENCY_MULTIPLIER=100`, SQLite çıktı dizinleri |
| `constant/ErrorManagement.js` | Java'dan birebir kopyalanmış hata kodları ve metinleri (**cihazlar bunlara göre davranıyor, değiştirilemez**). `ErrorManagement.throw(code, detay)` |
| `constant/TravelTypes.js` | F kaydının `travel_type` kodları (0–11) |
| `constant/Keystore.js` | Cihazların gönderdiği tel kodları (`BLOB="1"` — yani `?enc=1`) |

### 5.3 Dispatcher ve controller tabanı

**`validator/index.js`** (278 satır)

| Metot | İş |
|---|---|
| `loadControllers(dir)` | Açılışta `controller/` altındaki dosyaları yükler, `funcs` tablosu varsa anahtarlarını kaydeder; çakışan anahtar → hata |
| `resolveOffset(req)` | Operasyon günü kayması (dakika). Sistem başına bir kez `fn_get_system_pdate('M')` ile okunup bellekte tutulur |
| `cacheKeyFor(req, func)` | Bu istek cache'lenebilir mi, cache dosyasının adı ne? `fromservice=1` cache'i tamamen atlar |
| `systemViewFor(systemId)` | Sistem başına türetilmiş config görünümü + request-log fonksiyon kümesi. `system_cfg.revision` değişince atılır |
| `assertNoErrorPayload(data)` | Cevap bir `<ERROR>` belgesi mi? Önce ucuz bir regex, ancak eşleşirse XML parse edilir |
| `runAndCache(...)` | Controller'ı çalıştırır, cevabı doğrular, diske yazar; üretim işaretini **her durumda** temizler |

**`validator/ValidatorControllerBase.js`** — bütün controller'ların atası

| Metot | İş |
|---|---|
| `setValidatorStatus(req, action, extra)` | `pk_app_val.sp_setval_status` — "bu cihaz şu an şunu yapıyor" |
| `cfg(req, key, default)` | Config okuma: sistem satırı → `app` satırı → varsayılan |
| `cfgBool` / `cfgList` | `"false"`/`"0"` doğru okunur; virgüllü liste diziye çevrilir |
| `kpgTimeouts(req)` | Bağlanma ve okuma timeout'ları |
| `kafkaEnabled` / `kafkaOnly` | `<func>_use_kafka_producer`, `<func>_use_only_kafka_produce` |
| `produceKafka(...)` | Mesajı gönderir; hata `<func>_kafka_error_throw` açıksa isteği düşürür |
| `bodyElements(req)` | Gövdeyi `XmlWalk` ile düz listeye çevirir |
| `okResponse(res)` | Yazma endpoint'lerinin standart boş OK cevabı |
| `getServiceError(error, req)` | Hatayı cihaza gidecek koda çevirir. **Stack loglanır, cihaza gitmez** (sunucu yolları sızmasın) |
| `masksError(error)` | Bazı endpoint'ler ORA kodunu gizleyip sabit metin döner (`dbErrorMessage`) |

### 5.4 Controller'lar — 13 dosya, 65 endpoint

Dosya adı `?func=` değeri **değildir**; her dosya bir `funcs` tablosu export eder ve
anahtarları `?func=` değerleridir. Dosya içinde her endpoint `// ---- ?func=xxx` başlığıyla
ayrılmıştır, yani `grep -rn "?func=getbusstop" validator/controller/` tek komutta yerini bulur.

| Dosya | Endpoint'ler |
|---|---|
| `transaction.js` | `senddata` |
| `gps.js` | `sendgps`, `onlinegps` |
| `device.js` | `sendcfg`, `sendlog`, `sendcan`, `sendalarm`, `wlanstatus`, `getvalcfg`, `getvalidatorlist`, `getfile`, `getfiles` |
| `route.js` | `getroute`, `getroutepath`, `getroutebusstop`, `getroutecoordinate`, `getrouteschedule`, `getpath`, `getpathbusstop`, `getpathstage`, `getstage`, `getbusstop`, `getrouteinfodb` |
| `fare.js` | `getafcfares`, `getafcodmatrix`, `getafcproduct`, `getafczonegroup`, `getmstproducttype`, `getusagesummary`, `getzone`, `getuncalculatedtransaction`, `updateuncalculatedtransaction` |
| `card.js` | `getblacklist`, `getcarddetail`, `getcardinfo`, `getofflinecardlist`, `generatefreecardsqlite` |
| `bus.js` | `getbusinfo`, `getbusparkplace`, `getbusroute`, `getbusrouteplan`, `getvehiclestop` |
| `driver.js` | `getdriverpassword`, `setdriverpassword`, `verifydriver`, `getdriverplan`, `getdriverworkhours` |
| `schedule.js` | `getschedule`, `getscheduleplan`, `gettriptype`, `getdutyschedule`, `getavlrules` |
| `report.js` | `getreport`, `getreportinterval`, `getruninprogressreport` |
| `payment.js` | `realauth`, `sendemvdata` — ödeme geçidine saf proxy |
| `message.js` | `getmessageinfo`, `readmessage` |
| `service.js` | `getversion`, `synctime`, `getcacheinfo`, `cleancachefiles`, `getstatistics`, `resetstatistics` |

### 5.5 Bean'ler — XML → alan adları

XML attribute adlarıyla kolon adları aynı değil; bean'ler bu çeviriyi yapar.

| Dosya | İş |
|---|---|
| `validator/transaction/DataTransaction.js` (328) | `senddata`'nın `<DATA>` elemanı. **Dört ayrı eşleme tablosu**: `DATA_EXACT` (harfe duyarlı — Java `==` kullanıyordu), `DATA_CI` (duyarsız), `STATION_EXACT`/`STATION_CI` (istasyon farklı isimler kullanıyor), `EMV_CI`. `resetPerElement()` Java'nın her elemanda temizlediği alanları temizler — temizlenmeyenler bilerek sızar. `toKafkaPayload()` mesajı üretir |
| `validator/transaction/GpsTransaction.js` | `GPSDAT`/`CANDAT` elemanları, konum ve CAN verisi |
| `validator/transaction/CfgTransaction.js` | `sendcfg` — 50+ cihaz alanı; attribute adları kolon adlarıyla aynı olduğu için çeviri tablosu yok |
| `validator/transaction/LogTransaction.js` | `sendlog` — `LOG` cihaz kimliğini, `DATA` kaydın kendisini taşır |

### 5.6 Strategy ve visitor — `senddata`'nın karar katmanı

| Dosya | İş |
|---|---|
| `strategy/DataStrategy.js` | Otobüs yolu (Java `ins_data`). `record_id`'ye göre F/D/diğer dağıtımı |
| `strategy/DRecordStrategy.js` (247) | Bir bilet. Yer tutucu sefer, tutar normalizasyonu, imza doğrulama, tablo seçimi, EMV toplama |
| `strategy/FRecordStrategy.js` | Bir sefer kaydı. `travel_type`'a göre visitor planı çıkarır |
| `strategy/StationStrategy.js` | İstasyon yolu (Java `ins_station`). Vardiya açar, sonra bileti alt sınıfa devreder |
| `strategy/StationDRecordStrategy.js` | `DRecordStrategy`'yi extend eder, **yalnız üç farkı** override eder |
| `strategy/TchewDataStrategy.js` | Sistem 106'nın eski cihazları (Java `ins_data_tchew`). Pozisyonel insert'ler |
| `visitor/TravelTypeVisitor.js` | F kaydının travel_type dallarının her biri bir metot |

### 5.7 DAO katmanı

**Kural:** `conn.execute` yalnız `validator/dao/` altında olabilir — `test/architecture.test.js`
bunu zorlar. DAO'lar connection **açmaz**, parametre olarak alır.

| Dosya | İş |
|---|---|
| `validator/dao/BaseDao.js` | Bütün Oracle DAO'larının atası. `exec()` (yazma, `autoCommit:false`), `execIgnoreDuplicate()` (ORA-00001'i yutar), `callLob()` (N string IN + 1 LOB OUT — okuma endpoint'lerinin ortak şekli), `debugSql()` |
| `validator/dao/daoUtil.js` | `TX` (`{autoCommit:false}`), `withTransaction(conn, fn)` (commit/rollback sınırı), `isUniqueViolation(err)` |
| `validator/dao/sqlLog.js` | İfade izi **ve** kart maskeleme. `VS_SQL_DEBUG=0` izi kapatır ve o zaman maskeleme de hesaplanmaz. `card_no` → ilk6+son4, `ptcn`/`enc_pan` → `***` |
| `validator/dao/oracle/` | 45 DAO + 2 yardımcı. Tablo ya da paket başına bir dosya |
| `validator/dao/oracle/tdSql.js` | `AFC_TD` / `AFC_BL_TD` / `AFC_TD_TEST` ailesinin 16 INSERT varyantını tek yerden üretir. **Kolon sırası `test/dao/tdSql.test.js` ile sabitlenmiştir** — kayması iyi değerleri yanlış kolona yazar, hata vermeden |
| `validator/dao/sqlite/` | Cihaza giden `.db` dosyalarının tabloları (10 DAO + `SqliteBaseDao` + `SqliteDb`) |
| `validator/daoFactory/DaoFactory.js` | `oracle` / `sqlite` seçimi |

Öne çıkan DAO'lar:

- **`PkAppValDaoImpl`** — en büyüğü. Okuma endpoint'lerinin çoğu buradaki `sp_get_*` prosedürlerini çağırır
- **`AfcTfDaoImpl`** — sefer tablosu. Java'daki dört ayrı UPDATE, tek INSERT dalını paylaşan **dört MERGE**'e dönüştürüldü
- **`MstBusDaoImpl`** — `senddata`'nın kapı kontrolü. Varlık kontrolü `select 1 ... rownum=1`
- **`ConfigDaoImpl`** — KKCONFIG okuyan tek yer. `pickConfigAlias()` **yalnız `kkconfig` havuzunu** kabul eder, başka havuza düşmez
- **`ValidatorRequestLogDaoImpl`** — istek gövdesi kopyası; kendi commit'iyle yazılır

### 5.8 `util/` — veritabanına dokunmayan yardımcılar

| Dosya | İş |
|---|---|
| `FileCacheManager.js` (260) | Sekiz ağır okuma endpoint'inin disk cache'i. Tamamı asenkron (`fs/promises`) — senkron okuma tek event loop'u kilitlerdi. Gün dönümünde ağacı siler, üretim işaretlerini tutar |
| `HttpUtil.js` | Dış HTTP çağrıları. **keep-alive agent** ile — her çağrıda yeni TCP açılmaz. Java'nın iki fazlı timeout'unu (bağlan / oku) taklit eder |
| `KpgClient.js` | Ödeme geçidi proxy'si (`realauth`, `sendemvdata`) |
| `EmvUsageBatch.js` | Kredi kartı kullanımlarını tek belgede toplayıp geçide POST eder |
| `KafkaProducer.js` | `systemId + broker` başına producer cache'i. **Ateşle-unut** gönderim (Java da öyleydi): teslimat hatası isteği düşürmez |
| `SqliteBuilder.js` (209) | Cihaza giden `.db` dosyalarını üretir. Oracle'dan okur, belleğe yazar, dosyaya kopyalar |
| `XmlWalk.js` | XML'i belge sırasına göre düz listeye çevirir. Yarım gövdeyi reddeder (xml-js sessizce kabul ederdi) |
| `XmlRpc.js` | `sendalarm`'ın cihaza mesaj göndermek için kullandığı XML-RPC |
| `EccDsaVerify.js` | Sistem 112'nin imzalı kayıtlarını doğrular (ECDSA/SHA1) |
| `DatabaseError.js` | **Karar tablosu**: bozuk veri mi (dosyala + OK dön) yoksa gerçek DB hatası mı (cihaz tekrar denesin). 11 ORA kodu + 1830–1869 aralığı + 17 mesaj imzası |
| `StringUtil.js` | Java sayı ayrıştırma semantiği. `toJavaFloat` — Java `setFloat`'ın kolona yazdığı ondalığı üretir |
| `Gson.js` | Kafka mesajlarında **null alanlar belgeye hiç konmaz** (Gson varsayılanı; tüketiciler buna göre yazılmış) |
| `RequestStats.js` | `?func=` sayaçları, gece yarısı sıfırlanır |

### 5.9 Job'lar

Yapı `node-abt-terminal` ile aynı: job'lar `jobs/index.js`'te **düz obje** olarak durur
(`scope`, `flag`, `requires`, `intervalKey`, `mode`, `func`), `JobManager` ise onları okuyup
çalıştıran tek generic runner'dır. Açılışta config'i yükler (`waitForConfigPool` + retry),
sonra job'ları **periyoda göre gruplayıp** her gruba bir scheduler bağlar. Grup içindeki
job'lar sırayla koşar — `queueMax=1` havuzda aynı anda connection istememelerinin yolu budur.
Grupların ilk koşuşu 10'ar saniye kaydırılır (`GROUP_STAGGER_MS`).

| Job | Kapsam | Varsayılan | İş |
|---|---|---|---|
| `config_watch` | service | 5 dk | KKCONFIG'i yeniden okur; periyot değiştiyse job'ları yeniden bağlar |
| `cache_cleanup` | service | 1 saat | 24 saatten eski cache dosyalarını siler |

Bugün ikisi de servis geneli; `scope: "system"` yolu (sistem başına ctx + connection),
`requires` ve `mode: "async"` runner'da hazır bekliyor.

Bir turda önce **service** geçişi yapılır (config tazelenir), sonra her sistem için **system**
geçişi. Flag her turda okunur: DB'de bir flag açmak restart de rebind de istemez. Bir job'ın
hatası kendi turunu bitirir, diğer sistemleri etkilemez; hatalar tur sonunda birleştirilip
fırlatılır, böylece grup konsolda kırmızı görünür.

### 5.10 `management/` — `/Admin` ucu

`getversion`, `getconfig` (config'i okur ve bellekteki kopyayı tazeler; gizli anahtarları
maskeler), `getjobs` (grup durumları + her job'ın hangi sistemlerde açık olduğu),
`reloadconfig` (config'i tazeler ve gerekiyorsa job'ları yeniden bağlar).

---

## 6. Veri nereye yazılıyor

| Tablo | Ne düşer |
|---|---|
| `AFC_TD` | **Biletler** — ana tablo |
| `AFC_TD_EMV` | Kredi kartı ödeme ayrıntısı |
| `AFC_TD_TEST` | Test kartıyla yapılan işlemler |
| `AFC_TD_NONVERIFIED` | İmzası doğrulanamayan biletler (sistem 112) |
| `AFC_BL_TD` | Kara listedeki kart + sınıflandırılamayan kayıtlar |
| `AFC_TF` | **Seferler** |
| `AFC_TF_EVENT` | Sefer olayları (başladı, bitti, sürücü değişti…) |
| `AFC_TH` | **Vardiyalar** |
| `AFC_STATION` | İstasyon vardiyası |
| `TMS_GPS`, `TMS_APC`, `TMS_APC_EVENT`, `TMS_DOOR_STATUS`, `CAN_DATA` | Konum ve araç telemetrisi |
| `TMS_VAL_ROUTE` | Durağa giriş/çıkış |
| `TBL_DEVICE_CFG`, `TBL_DEVICE_HEALTH`, `TBL_DEVICE_LOG` | Cihazın kendi durumu |
| `TBL_RFCARD` | Kartın çip seri numarası güncellenir |
| `TBL_VALIDATOR_ERROR_TD` | **Kabul edilemeyen kayıtlar** — hata ararken ilk bakılacak yer |
| `VALIDATOR_REQUEST_LOG` | Ham istek gövdesi kopyası (yalnız `save_request_log_functions` listesindekiler) |

---

## 7. Validator Service'in işi nerede bitiyor

Bu servis **kaydı alır ve yazar**. Ondan sonrasını başkaları devralır:

```
                      ┌─> AFC_TD ...            Oracle          <- bizim isimiz burada biter
                      │
cihaz -> senddata ────┼─> Kafka                 (anahtar acikas)  -> node-validator-consumer
                      │                                              tuketir, ayni tablolara yazar
                      ├─> Ticket Engine         ham govde iletilir
                      │
                      └─> Odeme gecidi (KPG)    kredi karti kullanimlari
```

Dört tüketici:

1. **Oracle** — asıl hedef. Servisin birincil işi.
2. **Kafka** — `senddata`, `sendcfg`, `sendgps`, `sendlog` için ayrı ayrı açılabilir. `<func>_use_only_kafka_produce` açıksa **veritabanına hiç yazılmaz**, yalnız mesaj gider ve
   `node-validator-consumer` tüketip yazar.
3. **Ticket Engine** — `senddata`'nın ham gövdesi olduğu gibi iletilir. URL `PK_CONFIG`'den gelir; boşsa bu adım atlanır. Cevabı `code:0` değilse istek `-3` ile düşer.
4. **Ödeme geçidi (KPG)** — kredi kartı kullanımları `addUsageEmvValidator` ile bildirilir. `realauth`/`sendemvdata` ise saf proxy: gövde olduğu gibi geçide gider, cevabı olduğu gibi cihaza döner.

`transfer_ref_code='sync'` işaretli satırları sonradan **fiyatlama işi** alır; cihaz ücreti
kendi hesaplamamışsa fiyat orada belirlenir ve `updateuncalculatedtransaction` ile geri yazılır.

---

## 8. Debug rehberi

### 8.1 Her şeyden önce: `sessionId`

Her isteğe framework bir `sessionId` verir (`validatorservices_<zaman>`) ve **o isteğin ürettiği
her log satırında bu vardır**. Bir şikâyeti incelerken önce sessionId'yi bul, sonra ona göre
filtrele. Tek bir isteğin tüm hikâyesi çıkar.

### 8.2 Nereden başlanır — belirtiye göre

| Belirti | İlk bakılacak yer |
|---|---|
| **Cihaz kayıt gönderiyor ama tabloda yok** | `TBL_VALIDATOR_ERROR_TD`. Bozuk veri (ORA-12899, ORA-01722 vb.) buraya düşer ve cihaza **OK** denir — cihaz sorun olduğunu bilmez. Tabloya elle bakılır |
| **`-99 getConnection Err`** | Havuz doldu. `queueMax=1` olduğu için dolu havuz beklemez, reddeder. `?func=getstatistics` ve `/pools` bakılır |
| **`103 Database operation failed: ...`** | `senddata` içinde bir şey patladı. Loglarda `error processing transaction record_id=... sam_id=...` satırını ara — **gövdedeki hangi kaydın** patladığını söyleyen tek yer orası |
| **`-20095 File Not Ready`** | Aynı cache dosyasını başkası üretiyor. 2 dakika içinde kendiliğinden çözülür. Sürekli oluyorsa `?func=getcacheinfo`'ya bak |
| **`-9 unrecognized func`** | `?func=` yanlış yazılmış ya da endpoint kayıtlı değil. `grep -rn "?func=<isim>" validator/controller/` |
| **`-20093 Result Has Error` / `-20098 Get Full Version`** | Prosedür bir `<ERROR>` belgesi döndü; cache'e yazılmadı. Asıl hata Oracle tarafında |
| **`mst_bus validation failed`** | `bus_id` + `station_type` ikilisi `MST_BUS`'ta yok. Cihaz yanlış tanımlı ya da tanım süresi geçmiş |
| **`-2001 Another bus has an open session`** | Şoförün başka otobüste kapanmamış vardiyası var (`AFC_TH`, `travel_type='3'`) |
| **Cihaz eski veri kullanıyor** | Cache. `?func=cleancachefiles` tüm ağacı siler; `?func=getcacheinfo` durumu gösterir |
| **Config değişikliği etki etmiyor** | Bellekteki kopya eski. `?func=reloadconfig` (Admin ucu) tazeler; `config_watch` zaten 5 dakikada bir yapar |
| **Job'lar çalışmıyor** | `?func=getjobs`. `started:false` ise açılışta config yüklenememiştir — `kkconfig` havuzuna bak |

### 8.3 SQL izini açmak/kapatmak

Varsayılan **açık**: her `conn.execute` öncesi ifade ve maskelenmiş bind'lar loglanır.

```
VS_SQL_DEBUG=0    izi kapatir  (~%10 verim kazanci, senddata'da olculdu)
```

İz kapalıyken maskeleme de hesaplanmaz. Kart numaraları log satırında **ilk6\*\*\*\*son4**
biçiminde görünür; `ptcn` ve `enc_pan` tamamen `***`'dır — bu kasıtlı, ham hâlleri asla
loglanmaz.

### 8.4 Bir isteği baştan sona izlemek

```
1. sessionId'yi bul
2. "Connection Opened:017"            framework connection acti
3. ?func= satiri                      dispatcher hangi controller'a gitti
4. sp_setval_status                   controller basladi
5. asil SQL ifadeleri                 ne calisti, hangi bind'larla
6. "Connection Closed:017"            istek bitti
```

Arada `error processing transaction record_id=...` görürsen o kayıt patlamış demektir.

### 8.5 Yerel çalıştırma ve doğrulama

```
node tools/panel/server.js       -> http://localhost:3100   (yalniz loopback)
npm run test_validator_service   -> 361 test
node tools/compare/compare.js    -> okuma endpoint'lerini canli Java ile karsilastirir
node tools/load/load.js --matrix 1 --seconds 12
```

`tools/panel` iki servisi başlatır/durdurur, KKCONFIG ve test verisini basar, karşılaştırmaları
ve yük matrisini koşturur. Komut çalıştırıp satır sildiği için ağa açılmamalıdır.

### 8.6 Bilinen davranışlar — hata değil

- **Aynı kayıt iki kez gelir.** Cihaz `transmit_cnt` artırarak tekrar gönderir; duplicate insert sessizce yutulur.
- **Bozuk kayıt OK cevabı alır.** Tekrar göndermek düzeltmeyeceği için kayıt `TBL_VALIDATOR_ERROR_TD`'ye dosyalanır ve cihaza OK denir.
- **Bilet, seferinden önce gelebilir.** O zaman `travel_type=0` ile yer tutucu sefer açılır.
- **Bazı alanlar kayıttan kayda sızar.** Java `<DATA>` elemanları arasında bazı alanları temizlemiyordu; bu bilerek birebir korundu (`DataTransaction.PER_ELEMENT_RESET`).
- **`getuncalculatedtransaction` boş `<ROOT></ROOT>` döner.** Sorgu patlasa bile hata değil boş belge döner (Java öyleydi).

---

## 9. Yapılandırma

Config `VALIDATOR_SERVICE_CONFIG` tablosunda, satır başına bir `SYSTEM_ID` ve JSON bir `CONFIG`
kolonu. Okuma sırası: **sistemin kendi satırı → paylaşılan `app` satırı → koddaki varsayılan**.

Tablo yalnızca **`kkconfig` havuzundan** okunur; başka havuza düşülmez.

Sık kullanılan anahtarlar:

| Anahtar | İş |
|---|---|
| `currency_multiplier` | Tutarlar buna bölünür (varsayılan 100) |
| `card_type_check` | Test kartı tipleri |
| `credit_card_type` | Kredi kartı tipleri (varsayılan `11`) |
| `save_extended_fare` | Genişletilmiş ücret kolonu yazılsın mı |
| `save_request_log_functions` | Hangi endpoint'lerin gövdesi saklansın |
| `<func>_use_kafka_producer` | `senddata`/`sendcfg`/`sendgps`/`sendlog` için Kafka |
| `<func>_use_only_kafka_produce` | **Veritabanına hiç yazma**, yalnız Kafka |
| `<func>_topic`, `kk_bootstrap_servers` | Kafka hedefi |
| `credit_card_auth_url`, `credit_card_data_url` | Ödeme geçidi adresleri |
| `kpg_connect_timeout_ms`, `kpg_read_timeout_ms` | Ödeme geçidi zaman aşımları |
| `config_refresh_ms`, `cache_cleanup_interval_ms`, … | Job periyotları — hepsi `app` satırından |
| `run_config_watch`, `run_cache_cleanup` | Job açma anahtarları; sistem satırı `app`'i ezebilir |

Ortam değişkenleri:

| Değişken | Etki |
|---|---|
| `VS_SQL_DEBUG=0` | SQL izini kapatır |
| `VS_AUTOSTART=0` | Job katmanını başlatmaz. **Çok süreçli kurulumda biri hariç hepsinde şart** — aksi hâlde `cache_cleanup` aynı dosyaları N kez tarar, `config_watch` config tablosunu N kez okur |
