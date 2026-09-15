# node-validator-service

Otobüs ve istasyonlardaki validator cihazlarının konuştuğu HTTP servisi. Cihaz açılışta
ihtiyacı olan referans verisini (hat, güzergâh, durak, tarife, kara liste, sürücü planı) bu
servisten indirir; gün boyunca ürettiği bilet/sefer kayıtlarını, GPS'ini, log ve alarmlarını
yine buraya yükler. Servis bu isteklerin karşılığını Oracle'a yazar, kimi kayıtları Kafka'ya
üretir, kredi kartı işlemlerini ödeme geçidine iletir.

Tek bir HTTP ucu vardır ve endpoint `?func=` sorgu parametresiyle seçilir. Cevaplar XML'dir.

---

## İçindekiler

1. [Servis nasıl ayağa kalkar](#1-servis-nasıl-ayağa-kalkar)
2. [URL şekli ve `systemid`](#2-url-şekli-ve-systemid)
3. [Dizin yerleşimi](#3-dizin-yerleşimi)
4. [Bir isteğin yolculuğu](#4-bir-isteğin-yolculuğu)
5. [Endpoint kataloğu](#5-endpoint-kataloğu)
6. [`senddata` — en ağır yazma yolu](#6-senddata--en-ağır-yazma-yolu)
7. [DAO katmanı ve mimari kural](#7-dao-katmanı-ve-mimari-kural)
8. [Dosya cache'i](#8-dosya-cachei)
9. [SQLite dosya üretimi](#9-sqlite-dosya-üretimi)
10. [Kafka üretimi](#10-kafka-üretimi)
11. [Job katmanı](#11-job-katmanı)
12. [`/Admin` uçları](#12-admin-uçları)
13. [Yapılandırma](#13-yapılandırma)
14. [Hata kodları](#14-hata-kodları)
15. [Loglama ve SQL izi](#15-loglama-ve-sql-izi)
16. [Test](#16-test)
17. [`tools/` — yerel yardımcılar](#17-tools--yerel-yardımcılar)

---

## 1. Servis nasıl ayağa kalkar

Bu klasör tek başına çalışan bir uygulama değil, `node-app-server` altındaki bir **webapp**'tir.
Sunucu açılışta `webapps/` altındaki her klasörü tarar, `config/system_cfg.js` dosyasını okur ve
oradaki `context` değerini URL ön eki olarak kullanarak modülün export ettiği servisleri
Express router'ına bağlar.

`index.js` iki servis export eder:

```js
module.exports = [validator, management];   // /Validator  ve  /Admin
```

Aynı dosya açılışta ayrıca şunları yapar:

- Webapp mount edildikten **sonra** (`setImmediate`) job katmanını başlatır. Böylece yavaş bir
  config okuması endpoint'lerin ayağa kalkmasını geciktirmez.
- `SIGINT` / `SIGTERM` sinyallerinde Kafka producer'larını flush edip kapatır.

`VS_AUTOSTART=0` ile job katmanı hiç başlamaz; endpoint'ler normal çalışır. Testler bu modda
koşar ve **çok süreçli kurulumda bir süreç hariç hepsinde bu şarttır** — aksi hâlde
`cache_cleanup` aynı dosyaları N kez tarar, `config_watch` config tablosunu N kez okur.

---

## 2. URL şekli ve `systemid`

`context` değeri `"Validator Services"`, servis path'leri `/Validator` ve `Admin`:

```
GET|POST  /Validator%20Services/Validator?func=<endpoint>&systemid=<sid>&...
GET|POST  /Validator%20Services/Admin?func=<endpoint>
```

`systemid` (ya da `system_id` / `sid` / `region`) yalnızca hangi endpoint'in ne döneceğini değil,
**hangi veritabanına bağlanılacağını** da belirler: framework bu değeri `datasource_prefix` ön
ekiyle birlikte Oracle havuz alias'ı olarak kullanır ve bağlantıyı `req.dbConn` içine koyar.
`/Validator` `conn: true` ile kayıtlıdır — her istek bir bağlantı alır ve cevap yazıldıktan sonra
havuza geri verir. `/Admin` `conn: false`'tur, veritabanı bağlantısı almaz.

Her istek ayrıca bir `req.sessionId` alır (`nodevalidatorservice_<zaman damgası>`); loglarda bir
isteği baştan sona izlemenin yolu budur.

---

## 3. Dizin yerleşimi

| Yol | İş |
|---|---|
| `index.js` | Webapp girişi; servisleri export eder, job'ları başlatır, kapanışta Kafka'yı kapatır |
| `config/system_cfg.js` | `context`, sürüm ve bellekteki config kopyası (`cfgs`, `getSystemConfig`, `setCfgs`) |
| `constant/` | Hata kodları, sabitler, cihazın gönderdiği kod değerleri, seyahat tipleri |
| `validator/index.js` | `/Validator` dispatcher'ı: controller yükleme, cache, istek logu, hata sarmalama |
| `validator/ValidatorControllerBase.js` | Controller taban sınıfı: config okuma, Kafka üretimi, XML gövde okuma, hata çevirimi |
| `validator/controller/` | 13 dosya, 65 endpoint — konuya göre gruplanmış |
| `validator/transaction/` | Gelen XML'i alan adlarına çeviren nesneler (`DataTransaction`, `GpsTransaction`, …) |
| `validator/dao/oracle/` | Oracle DAO'ları — servisteki tek SQL yeri |
| `validator/dao/sqlite/` | Üretilen `.db` dosyalarına yazan DAO'lar |
| `validator/daoFactory/` | `daoFactory.get("MstBusDaoImpl")` — sınıf adından DAO çözer |
| `strategy/` + `visitor/` | `senddata`'nın karar katmanı: kayıt tipi, seyahat tipi, hangi tabloya |
| `jobs/` | Zamanlanmış işler ve zamanlayıcı |
| `management/index.js` | `/Admin` uçları |
| `util/` | Veritabanına dokunmayan yardımcılar (aşağıda) |
| `tools/` | Yerel geliştirme harness'ları — servisin parçası değil, istek yolunda hiç yüklenmez |
| `test/` | Mocha testleri |
| `validatorCacheFiles/` | Dosya cache'inin kök dizini (çalışma dizini altında) |

`util/` içindekiler:

| Dosya | İş |
|---|---|
| `FileCacheManager.js` | Ağır okuma endpoint'lerinin disk cache'i; dosya adı ve gün mantığı |
| `KafkaProducer.js` | Producer havuzu, broker listesi, bekleme süresi sınırı |
| `SqliteBuilder.js` | Cihaza inen `.db` dosyalarını üretir (akış; SQL yine DAO'da) |
| `XmlWalk.js` | Ham gövdeyi tam DOM'a çevirmeden eleman/öznitelik gezme |
| `Gson.js` | Kafka'ya giden JSON gövdelerin üretimi |
| `HttpUtil.js` | Bağlan/oku zaman aşımı olan POST istemcisi |
| `KpgClient.js` | Ödeme geçidi çağrısı (`realauth`, `sendemvdata` düz proxy) |
| `EmvUsageBatch.js` | Bir `senddata` gövdesindeki kredi kartı kullanımlarını toplayıp tek belge olarak gönderir |
| `EccDsaVerify.js` | İmzalı kayıtların doğrulaması |
| `RequestStats.js` | `systemid` + `func` bazında bellek içi çağrı sayacı (`?func=getstatistics`) |
| `StringUtil.js`, `DatabaseError.js`, `XmlRpc.js` | Ayrıştırma, ORA hata sınıflandırma, XML-RPC yardımcıları |

---

## 4. Bir isteğin yolculuğu

`validator/index.js` şu sırayı işletir:

1. **Controller çözümü.** Açılışta `validator/controller/` altındaki her dosya yüklenir; her
   dosya bir `funcs` tablosu export eder ve tablonun anahtarları o dosyanın cevapladığı `?func=`
   değerleridir. İki dosya aynı anahtarı iddia ederse yükleme sırasında hata fırlatılır —
   sessizce gölgelenen bir endpoint ancak cevap alamayan cihazdan fark edilirdi.
   Tanınmayan `func` → `-9`.
2. **Sayaç.** `RequestStats.add(systemId, func)` — dağıtımdan önce, yani hata alan çağrılar da sayılır.
3. **Config görünümü.** Sistemin config satırı `app` satırının üstüne serilir ve `req.cfg` olarak
   isteğe iliştirilir. Bu görünüm sistem başına bir kez kurulur ve `system_cfg.revision`
   değiştiğinde (config yenilendiğinde) atılır; istek başına yeniden hesaplanmaz.
4. **İstek logu.** `func`, `save_request_log_functions` listesindeyse ham gövde
   `VALIDATOR_REQUEST_LOG`'a yazılır. `*_use_only_kafka_produce` açık olan fonksiyonlarda
   atlanır: veritabanına yazılan bir şey olmadığı için ilişkilendirilecek kayıt da yoktur.
5. **Cache.** Endpoint cache'lenebilir listedeyse ve istek bugünün işletim gününe aitse dosya adı
   hesaplanır (bkz. [Dosya cache'i](#8-dosya-cachei)). Dosya varsa doğrudan döner. Yoksa ve başka
   bir istek aynı dosyayı üretiyorsa `-20095 File Not Ready` döner.
6. **Controller.** Cevap `res.locals.data` içine yazılır; framework onu gövdeye çevirir.
   Cache'lenecek cevap diske yazılmadan önce içinde `<ERROR>` var mı diye bakılır — hata belgesi
   asla cache'lenmez (`-20093`, tam sürüm isteniyorsa `-20098`).
7. **Hata.** `ServiceError` olduğu gibi, diğer her şey `-99` olarak cihaza gider; stack yalnızca
   log'a yazılır (cevap açık ağdaki bir cihaza gidiyor).

Bir controller'ın kalıbı:

```js
class GetBusInfo extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetBusInfo ");
            const dao = this.daoFactory.get("MstBusDaoImpl");
            res.locals.data = await dao.getBusInfo(req.dbConn, { /* ... */ }, req.sessionId);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);          // her yolda tam olarak bir kez
        }
    }
}
module.exports = { funcs: { getbusinfo: new GetBusInfo() } };
```

`ValidatorControllerBase`'in verdikleri: `cfg` / `cfgBool` / `cfgList` (sistem → `app` →
varsayılan sıralı config okuma), `bodyElements(req)` (ham gövdeyi gezme), `produceKafka`,
`okResponse`, `setValidatorStatus`, `kpgTimeouts`, `getServiceError` ve DAO erişimi.

---

## 5. Endpoint kataloğu

65 endpoint, konuya göre 13 dosyada. Anahtarlar dosyaların `funcs` tablosundan gelir.

| Dosya | `?func=` değerleri |
|---|---|
| `bus.js` | `getbusinfo`, `getbusparkplace`, `getbusroute`, `getbusrouteplan`, `getvehiclestop` |
| `card.js` | `getblacklist`, `getcarddetail`, `getcardinfo`, `getofflinecardlist`, `generatefreecardsqlite` |
| `device.js` | `sendcfg`, `sendlog`, `sendcan`, `sendalarm`, `wlanstatus`, `getvalcfg`, `getvalidatorlist`, `getfile`, `getfiles` |
| `driver.js` | `getdriverpassword`, `setdriverpassword`, `verifydriver`, `getdriverplan`, `getdriverworkhours` |
| `fare.js` | `getafcfares`, `getafcodmatrix`, `getafcproduct`, `getafczonegroup`, `getmstproducttype`, `getusagesummary`, `getzone`, `getuncalculatedtransaction`, `updateuncalculatedtransaction` |
| `gps.js` | `sendgps`, `onlinegps` |
| `message.js` | `getmessageinfo`, `readmessage` |
| `payment.js` | `realauth`, `sendemvdata` |
| `report.js` | `getreport`, `getreportinterval`, `getruninprogressreport` |
| `route.js` | `getroute`, `getroutepath`, `getroutebusstop`, `getroutecoordinate`, `getrouteschedule`, `getpath`, `getpathbusstop`, `getpathstage`, `getstage`, `getbusstop`, `getrouteinfodb` |
| `schedule.js` | `getschedule`, `getscheduleplan`, `gettriptype`, `getdutyschedule`, `getavlrules` |
| `service.js` | `getversion`, `synctime`, `getcacheinfo`, `cleancachefiles`, `getstatistics`, `resetstatistics` |
| `transaction.js` | `senddata` |

Kabaca üç grup: **referans veri indirme** (`get*`), **cihazdan yükleme** (`send*`) ve
**servis bakımı** (`service.js`).

---

## 6. `senddata` — en ağır yazma yolu

Cihazın biriktirdiği bilet ve sefer kayıtları tek bir XML gövdesinde gelir; her kayıt bir
`<DATA>` elemanıdır ve kredi kartı bilgisi varsa altında bir `<EMV>` çocuğu taşır.

```
senddata
  ├─ setValidatorStatus            cihazın son durumu yazılır
  ├─ senddataConfig                currency_multiplier, kart tipleri, kafka anahtarları …
  ├─ mst_bus doğrulaması           bus_id + station_type kayıtlı mı
  ├─ strateji seçimi (istek başına bir kez)
  │     ├─ DataStrategy            otobüs (station_type 1 veya 5)
  │     ├─ StationStrategy         istasyon
  │     └─ TchewDataStrategy       yalnız sistem 106 + şirket ≠ 1
  ├─ her <DATA> için
  │     ├─ DataTransaction         öznitelik → alan adı eşlemesi
  │     ├─ Kafka                   senddata_use_kafka_producer açıksa
  │     └─ kayıt yazımı            kayıt başına bir transaction
  ├─ EMV kullanımları              gövdedeki kredi kartı kullanımları tek belge hâlinde geçide
  └─ ticket engine'e iletim        PK_CONFIG'teki URL boş değilse ham gövde iletilir
```

Kayıt tipi `record_id`'nin ilk harfinden okunur: **D** bilet, **F** sefer. F kayıtlarında
`travel_type` `TravelTypeVisitor`'ın hangi metotlarının koşacağını belirler (vardiya açma/kapama,
durak giriş/çıkış, kilometre, yolcu sayımı…) ve bir kayıt için birden fazlası çalışabilir.
D ve F dışındaki kayıtlar sınıflandırılamayan kayıt tablosuna yazılır.

Önemli davranışlar:

- **Transaction sınırı bir kayıttır**, bir istek değil. Bozuk tek bir kayıt, aynı gövdedeki
  sağlam kayıtları geri almaz.
- **Bozuk kayıt cihaza OK döner** ve `TBL_VALIDATOR_ERROR_TD`'ye dosyalanır; tekrar göndermek
  düzeltmeyeceği için cihaz meşgul edilmez.
- **Aynı kayıt iki kez gelebilir**; duplicate key sessizce yutulur (`execIgnoreDuplicate`).
- **Bilet, ait olduğu seferden önce gelebilir**; o durumda yer tutucu bir sefer satırı açılır.
- Ayrıştırılamayan gövde log'a yazılır, hata kaydı düşülür ve cihaza yine OK denir.

---

## 7. DAO katmanı ve mimari kural

Servisteki **tüm** SQL `validator/dao/` altındadır. Bu bir konvansiyon değil, testtir:
`test/architecture.test.js`, `dao/` dışındaki hiçbir dosyada `conn.execute(...)`,
`require('oracledb')`, `require('node:sqlite')` ya da SQL metni bulunmadığını doğrular.
(`tools/` ve `test/` bu kuralın dışındadır.)

- `BaseDao` yazma ifadelerinin ortak şeklini verir: `exec` (autocommit kapalı — commit sınırı
  controller'ındır), `execIgnoreDuplicate`, `callLob` (N string IN + bir OUT LOB; okuma
  endpoint'lerinin neredeyse tamamı bu kalıptadır, LOB gelmezse controller `-97` döner).
- `daoUtil.withTransaction(conn, fn)` commit/rollback sarmalayıcısıdır.
- `daoFactory.get("<SınıfAdı>", "sqlite"?)` DAO çözer; ikinci argüman verilmezse Oracle.
- SQLite DAO'ları `BaseDao`'yu genişletmez: `node:sqlite` senkrondur ve havuz/transaction
  mekaniğinin oradaki bir karşılığı yoktur.

---

## 8. Dosya cache'i

Sekiz ağır okuma endpoint'inin cevabı diske yazılır ve aynı gün aynı isteği yapan diğer
cihazlara dosyadan servis edilir:

`getvehiclestop`, `getpathbusstop`, `getfiles`, `getroute`, `getpath`, `getroutepath`,
`getrouteschedule`, `getofflinecardlist`.

- Kök dizin: çalışma dizini altındaki `validatorCacheFiles/<KONU>/`.
- Dosya adı: `<systemid>_<KEY>_<version>_<yyyyMMdd>`. `getfiles` sürüm yerine `type_fileid`,
  `getrouteschedule` sürüme `timeunit` ekler.
- **İşletim günü**, sistem başına bir kez veritabanından okunan dakika cinsinden bir kaymayla
  hesaplanır (gün sınırında beş dakika tolerans). Cevap paylaşılabilir değilse — istek başka bir
  güne aitse, `fromservice=1` ise, ya da endpoint'in kendi istisnalarına giriyorsa — cache hiç
  devreye girmez.
- Aynı dosyayı iki istek birden üretmez: üretim başlarken işaret konur ve **her** sonuçta
  (başarı dâhil) kaldırılır; bu sırada gelenler `-20095 File Not Ready` alır.
- `<ERROR>` içeren cevap asla cache'lenmez. Kontrol önce ham metinde `<ERROR` var mı diye bakar;
  yoksa belge hiç ayrıştırılmaz — birkaç MB'lık kart listelerinde bu tek başına ölçülebilir bir
  kazançtır.
- Süpürme: `cache_cleanup` job'u `cache_max_age_ms`'ten (varsayılan 24 saat) eski dosyaları siler;
  `?func=cleancachefiles` elle temizler, `?func=getcacheinfo` durumu gösterir.

---

## 9. SQLite dosya üretimi

`getrouteinfodb` ve `generatefreecardsqlite` cihazın indirdiği `.db` dosyalarını üretir.
Sürücü `node:sqlite`'tır (ek bağımlılık yok, Node 22.5+ gerekir).

| Konu | Karar |
|---|---|
| Akış | Oracle'dan oku (await) → bellek içi veritabanına tek blokta yaz → `backup()` ile dosyaya kopyala |
| Çıktı | `<yyyyMMdd>_local_.db`, `ValidatorServiceRouteDbFile/` ve `ValidatorServiceFreeCardDbFile/` altında |
| `?cache=1` | Bugünün dosyası varsa o döner; aksi hâlde her çağrıda yeniden üretilir |
| WAL | Açılmaz — `-wal`/`-shm` dosyaları oluşur ve cihaza giden `.db` eksik kalırdı |
| Temizlik | Üretim sonrası çıktı dizinindeki 24 saatten eski dosyalar silinir |

---

## 10. Kafka üretimi

Dört endpoint kayıtlarını Kafka'ya da üretebilir: `senddata`, `sendcfg`, `sendgps`, `sendlog`.
Her biri kendi anahtar setiyle yönetilir:

| Anahtar | Etki |
|---|---|
| `<func>_use_kafka_producer` | Kafka'ya üretim açık |
| `<func>_use_only_kafka_produce` | **Veritabanına hiç yazma**, yalnız Kafka (istek logu da atlanır) |
| `<func>_topic` | Hedef topic |
| `<func>_kafka_error_throw` | Üretim hatası isteği düşürsün mü (varsayılan: hayır, yalnız log) |
| `kk_bootstrap_servers_<func>` → `kk_bootstrap_servers` | Broker listesi; fonksiyona özel liste boşsa ortak listeye düşülür |
| `kafka_producer_retries`, `kafka_producer_max_block_ms` | Yeniden deneme sayısı ve bekleme sınırı |

Producer'lar `systemId + broker listesi` başına önbelleklenir; bir gönderim başarısız olursa çift
atılır ve sonraki çağrı yenisini kurar. Kapanış sinyalinde hepsi flush edilip kapatılır.
Üretim hatası varsayılan olarak `-99999` koduyla loglanır ama isteği düşürmez.

---

## 11. Job katmanı

`jobs/index.js` iş listesini, `jobs/JobManager.js` zamanlayıcıyı tutar. Aynı periyoda düşen
işler tek bir grup hâlinde zamanlanır.

| Job | Kapsam | Açma anahtarı | Periyot anahtarı | Varsayılan |
|---|---|---|---|---|
| `config_watch` | servis | `run_config_watch` | `config_refresh_ms` | 5 dk, açık |
| `cache_cleanup` | servis | `run_cache_cleanup` | `cache_cleanup_interval_ms` | 1 saat, açık |

- Açık/kapalı bilgisi her turda **canlı config'ten** okunur; bağlanma anındaki değer saklanmaz.
- Periyotlar `app` satırından okunur; açma anahtarını sistem satırı ezebilir.
- `/Admin?func=reloadconfig` config'i yeniden okur **ve** işleri yeniden bağlar, yani değişen bir
  periyot hemen etkili olur.
- `VS_AUTOSTART=0` katmanı hiç başlatmaz.

---

## 12. `/Admin` uçları

Veritabanı bağlantısı almayan, JSON dönen bakım uçları:

| `?func=` | Ne yapar |
|---|---|
| `getversion` | Uygulama adı, sürüm, açılış zamanı |
| `getconfig` | Config tablosunu okur, bellekteki kopyayı tazeler ve maskelenmiş hâlde döner (`pass`/`secret`/`token`/`pwd`/`credential`/`apikey` geçen anahtarlar `***`). `?systemid=` ile tek sistem |
| `getjobs` | Her job'un kapsamı, bağlı olduğu grup, periyodu, son çalışma/süre/hata bilgisi ve **hangi sistemlerde açık olduğu** |
| `reloadconfig` | Config'i yeniden okur ve job'ları yeniden bağlar |

---

## 13. Yapılandırma

Config `VALIDATOR_SERVICE_CONFIG` tablosundadır: satır başına bir `SYSTEM_ID` ve JSON bir
`CONFIG` kolonu. Okuma sırası **sistemin kendi satırı → paylaşılan `app` satırı → koddaki
varsayılan**.

Tablo **yalnızca `kkconfig` adlı Oracle havuzundan** okunur; başka havuza düşülmez. Bu bilinçli:
havuzlar teker teker kuruluyor, dolayısıyla "kkconfig yok" ile "henüz kurulmadı" dışarıdan aynı
görünüyor — geri düşmek, servisin yanlış konfigürasyonla sessizce çalışmaya başlaması demek
olurdu. Tablo adı `kk_config_scheme` ile şema öneki alabilir; başka hiçbir tabloya önek uygulanmaz.

İstekler config'i **bellekten** okur. `config_watch` beş dakikada bir tazeler; anında etki için
`/Admin?func=reloadconfig`. Bir değişiklik en geç bir `config_refresh_ms` sonra isteklere yansır.
Bozuk JSON'lu bir satır loglanıp atlanır — tek satır bütün servisi konfigürasyonsuz bırakmaz.

Sık kullanılan anahtarlar:

| Anahtar | İş |
|---|---|
| `currency_multiplier` | Tutarlar buna bölünür (varsayılan 100). Bazı sistemlerde koddan 1'e sabitlenir |
| `card_type_check` | Test kartı tipleri |
| `credit_card_type` | Kredi kartı tipleri (varsayılan `11`) |
| `save_extended_fare` | Genişletilmiş ücret kolonu yazılsın mı |
| `get_total_stop_cnt_from_pattern` | Toplam durak sayısı desenden mi okunsun |
| `server_environment` | `prod` / `test`; test ortamı kredi kartı yolculuklarının tamamını geçide bildirir |
| `save_request_log_functions` | Hangi endpoint'lerin gövdesi `VALIDATOR_REQUEST_LOG`'a yazılsın (virgüllü liste ya da dizi) |
| `credit_card_auth_url`, `credit_card_data_url` | Ödeme geçidi adresleri; boş URL o adımı kapatır |
| `kpg_connect_timeout_ms`, `kpg_read_timeout_ms` | Ödeme geçidi zaman aşımları (30s / 60s) |
| `verify_driver_comp`, `getbusrouteplan_compcode_query`, `getbusrouteplan_driverid_query` | İlgili endpoint'lerin sorgu varyantları |
| `sp_create_offline_recharge_xml_includes_provno` | Prosedürün imza varyantı |
| `datasource_prefix` | Havuz alias'ının `systemid` önüne eklenecek ön ek |
| `<func>_use_kafka_producer`, `<func>_use_only_kafka_produce`, `<func>_topic`, `kk_bootstrap_servers` | [Kafka](#10-kafka-üretimi) |
| `config_refresh_ms`, `cache_cleanup_interval_ms`, `cache_max_age_ms` | Job periyotları — `app` satırından |
| `run_config_watch`, `run_cache_cleanup` | Job açma anahtarları |

Değerler JSON CLOB'tan geldiği için bir bayrak `true` yerine `"true"` olarak gelebilir;
`cfgBool` bunu ve `"0"` / `"false"` / `""` durumlarını doğru okur.

Ortam değişkenleri:

| Değişken | Etki |
|---|---|
| `VS_AUTOSTART=0` | Job katmanını başlatmaz (testler ve çok süreçli kurulumdaki fazla süreçler) |
| `VS_SQL_DEBUG=0` | SQL izini kapatır |

---

## 14. Hata kodları

Cevap belgesindeki kod, cihazların eşleştiği sözleşmedir. `constant/ErrorManagement.js`
tamamını tutar; sık görülenler:

| Kod | Anlam |
|---|---|
| `-3` | `func` belirtilmemiş / ticket engine hatası |
| `-9` | Tanınmayan `func` |
| `-55`, `-56` | Sürücü bulunamadı / PIN uyuşmuyor |
| `-97` | Veritabanından veri alınamadı (prosedür LOB üretmedi) |
| `-99` | Beklenmeyen hata |
| `-2001` | Bu sürücünün başka bir otobüste açık oturumu var |
| `-20093` / `-20098` | Cevap hata belgesi içeriyor / tam sürüm iste |
| `-20094` … `-20096` | İndirme başarısız / dosya hazır değil / dosya yok |
| `-99999` | Kafka üretim hatası |

Okuma endpoint'lerinin çoğu `dbErrorMessage` ile ORA hatalarını sabit bir metne çevirir; ham
veritabanı mesajı cihaza gitmez, log'da kalır.

---

## 15. Loglama ve SQL izi

Her istek `sessionId` ile loglanır; bir isteğin izi kabaca şu satırlardan oluşur:

```
Connection Opened:017            bağlantı alındı
<func>                           dispatcher hangi endpoint'e gittiğini yazar
SQL ifadeleri + bind'lar         ne çalıştı, hangi değerlerle
Connection Closed:017            istek bitti
```

SQL izi varsayılan olarak açıktır ve `VS_SQL_DEBUG=0` ile kapatılır. Bind değerleri
**maskelenerek** yazılır: `ptcn`, `enc_pan`, `emv`, `track2`, `cvv`, `pin`, `pin_block` tamamen
gizlenir; kart numarası taşıyan alanlar ilk 6 + son 4 hâline getirilir (kısa değerler tamamen
gizlenir).

`error processing transaction record_id=...` satırı, `senddata` gövdesindeki tek bir kaydın
patladığını gösterir — istek yine OK dönmüştür.

---

## 16. Test

```
npm run test_validator_service
```

Kök projeden koşar (mocha + mochawesome, rapor `test-report/` altına). 300'ün üzerinde test var
ve **hiçbiri veritabanına ya da Kafka'ya bağlanmaz**: `test/fakeConn.js` ve `test/fakeKafka.js`
sahte bağlantı/producer verir, `test/rootHooks.js` her testten önce süreç genelindeki
önbellekleri temizler.

| Klasör | Kapsam |
|---|---|
| `test/architecture.test.js` | DAO sınırı — `dao/` dışında SQL veya sürücü kullanımı yok |
| `test/validator/` | Endpoint davranışları: cache akışı, Kafka üretimi, hata maskeleme, yazma uçları |
| `test/strategy/` | `senddata` karar katmanı |
| `test/transaction/` | XML → alan adı eşlemeleri |
| `test/dao/` | SQL üretimi ve bind'lar |
| `test/util/`, `test/jobs/` | Yardımcılar ve zamanlayıcı |

---

## 17. `tools/` — yerel yardımcılar

Servisin parçası değildir, istek yolunda hiç yüklenmez, mimari kuralın dışındadır.

| Araç | İş |
|---|---|
| `tools/panel/server.js` | Yerel kontrol paneli (`http://localhost:3100`). Servisi başlatır/durdurur, test şemasını hazırlar, karşılaştırma ve yük koşularını tetikler. **Yalnız loopback'e bağlanır; ağa açılmamalıdır** — komut çalıştırır ve satır siler |
| `tools/compare/compare.js` | Aynı okuma isteklerini iki servis adresine atıp cevapları normalize ederek diff'ler |
| `tools/compare/compareWrites.js` | Aynısını yazma uçları için: isteği atar, veritabanına ne yazıldığını karşılaştırır |
| `tools/load/load.js` | Yük harness'ı: `--scenario`, `--concurrency`, `--seconds`, `--matrix 1` |

Üçü de yerel bir test şemasına karşı elle çalıştırılmak üzere yazılmıştır.
