# node-validator-service

ValidatorServices (Java WAR, v5.92.0) migrasyonunun Node.js karşılığı.
Bu bir **webapp**'tir, bağımsız bir servis değil: `node-app-server/webapps/` altına
klonlanır ve tüm bağımlılıklarını (oracledb, moment, xml-js, ULog, connection pool)
parent projeden alır. Bu yüzden kendi `package.json` dosyası yoktur.

## Yerleşim

```
node-app-server/
  webapps/
    node-validator-service/   <- bu repo
```

## Yapı

| Klasör | İçerik |
|---|---|
| `index.js` | Webapp sözleşmesi: route dizisi export eder (`validator`, `management`) |
| `config/system_cfg.js` | Route prefix (`Validator Services`) ve KKCONFIG erişimi |
| `validator/index.js` | Dispatcher — `?func=` anahtarını controller'a bağlar, dosya cache yolunu yürütür |
| `validator/controller/` | Endpoint başına bir dosya; **dosya adı (küçük harf) = `?func=` değeri** |
| `validator/dao/oracle/` | Oracle: tablo ya da package başına bir dosya |
| `validator/dao/sqlite/` | Cihaza giden `.db` dosyalarının tabloları (10 DAO + `SqliteDb`) |
| `validator/daoFactory/` | `oracle` / `sqlite` implementasyon seçimi |
| `bean/` | XML gövdesini DAO bind objesine çeviren düz veri sınıfları |
| `strategy/` | `senddata`'nın üç yolu (otobüs, istasyon, tchew) |
| `util/` | FileCacheManager, RequestStats, LogMask, HttpUtil/KpgClient, XmlWalk, SqliteBuilder — veritabanına dokunmaz |
| `constant/` | Java'dan birebir taşınan hata kodları ve sabitler |
| `jobs/` | Zamanlanmış işler (7 job) + `JobManager` |
| `management/` | `?func=getversion`, `getconfig`, `getjobs`, `reloadconfig` |
| `test/` | Mocha; `test/architecture.test.js` DAO katmanı kuralını zorlar |

## Test

Parent projeden çalıştırılır:

```
npm run test_validator_service
```

## Parent projede gereken değişiklikler

Bu repo tek başına çalışmaz. `node-app-server` tarafında tek bir ekleme gerekir;
yeni bir klondan sonra uygulanmalıdır.

**`node-app-server/package.json` — scripts:**

```json
"test_validator_service": "mocha ./webapps/node-validator-service/test --recursive --exit --reporter=./node_modules/mochawesome --reporter-options reportDir=webapps/node-validator-service/test-report,reportTitle=\"Validator Services Test Report\",reportPageTitle=\"Validator Service Test Report\",overwrite=true,enableCode=false"
```

Boyut ve karmaşıklık limitleri (metot 80 satır, derinlik 4, dosya 400 satır) bir lint
kuralı ile zorlanmıyor; kod bunlara uyacak şekilde yazılıyor. DAO katmanı kuralını ise
`test/architecture.test.js` zorluyor — dosyalarda `require('oracledb')` veya SQL metni
`validator/dao/` dışında görünürse test kırmızıya döner.

## Migrasyon durumu

Faz 1-8 tamamlandı, Faz 9 sürüyor: 65 controller, 45 Oracle DAO, 10 SQLite DAO, 7 job, 3 strateji, 4 bean, 338 test.
(Ayrıca `oracle/` altında DAO olmayan 2 yardımcı: `tdSql.js` SQL builder, `apcBind.js` ortak projeksiyon.)

**DAO sayısı neden Java'nın 9'undan fazla:** Java'da 9 DAO sınıfı vardı ama tüm SQL'in
sadece %14'ünü kapsıyorlardı — 190 statement noktasının 27'si. Kalan 163'ü 7 library
dosyasının içine gömülüydü. Roadmap kararı #6 ("veritabanı erişimi yalnız DAO katmanında")
+ "DAO tek tablo veya tek paket" kuralı gereği sayı, servisin dokunduğu farklı
tablo/paket sayısına eşit oldu. Roadmap §21 bunu 59 olarak öngörmüştü.

Java'daki 67 `?func=` dalının 65'i taşındı. Kalan 2'si (`getcardlist`, `getonlineschedule`)
ölü kod, taşınmayacak. **Endpoint borcu kalmadı.**

Kalan iş: Faz 9.2 yük testi, 9.5 paralel çalıştırma, 9.6 kademeli geçiş.

## Kontrol paneli

```
node tools/panel/server.js     ->  http://localhost:3100
```

Bu bölümdeki her şeyi düğmeyle çalıştırır: iki servisi başlat/durdur, KKCONFIG ve test
verisini bas, test satırlarını temizle, karşılaştırmaları ve yük matrisini koştur, raporları
oku. Çıktı canlı akar (SSE). Yalnız loopback'e bağlanır — komut çalıştırıp satır sildiği için
ağa açılmamalıdır.

Panelin bastığı SQL `tools/panel/sql/` altında: `seed-kkconfig.sql` (env.properties'ten
18 satır), `seed-testdata.sql` (otobüs `00001`, istasyon `00002`, sürücü `D0001`),
`clean.sql` (yalnız araçların yazdığı satırlar; seed verisi ve KKCONFIG kalır).

## Java ile karşılaştırma (Faz 9)

`tools/compare/` iki servise aynı isteği gönderip cevapları ve yazılan satırları karşılaştırır.
Mocha ile çalışmaz; elle çalıştırılan bir kabul aracıdır ve iki servisin de ayakta olmasını ister.

```
node tools/compare/compare.js        # okuma endpoint'leri  -> tools/compare/report.md
node tools/compare/compareWrites.js  # yazma yolları        -> tools/compare/report-writes.md
```

> `compareWrites.js` **veri siler**: her vakanın satırlarını iki koşu arasında ve sonunda
> temizler. Yalnızca yerel test veritabanına doğrultulmalıdır.

Son durum: okuma **46 aynı / 0 farklı** (4 endpoint doğası gereği karşılaştırılamaz ve
raporda gerekçesiyle listelenir), yazma **25 aynı / 1 beklenen fark** (26 vaka).

## Yük karşılaştırması (Faz 9.2)

```
node tools/load/load.js --matrix 1 --seconds 12
```

Aynı isteği iki servise sürüp taşıdıkları yükü raporlar (`tools/load/report-load.md`).
**Donanım kıyaslaması değildir** — Java konteynerde, bu servis doğrudan makinede çalışıyor;
anlamlı olan şekil. Isınma şart: ısınmasız ölçüm JIT maliyetini Java'nın sırtına yıkar.

Eşzamanlılık 8'de bu servis Java'nın **%65–98**'ini taşıyor (prosedür çağrısında %98,
okumada %89, `senddata`'da %65).

**CPU nereye gidiyor.** `senddata` profilinde çalışan CPU'nun **~%50'si log çıktısı**
(ELK'e UDP %18, senkron stdout %16, mesaj kurma/temizleme gerisi), %16 oracledb thin
sürücü, **%4 bu servisin kendi kodu**. `ULog`'da seviye filtresi yok: her çağrı mesajı
kurup stdout'a yazıp UDP atıyor.

`VS_SQL_DEBUG=0` ifade izini kapatır (maskeleme de hesaplanmaz) ve `senddata`'da
**~%10** kazandırır — profilin ima ettiği %50 değil, çünkü süreç bu eşzamanlılıkta tam
CPU-bound değil, zamanın bir kısmını Oracle'ı beklemekle geçiriyor. Kazanç anlık verim
değil, başlık.

**Yapısal tavan ve çözümü.** Tek Node süreci = tek çekirdek + tek havuz (10 bağlantı);
Tomcat hem çekirdeklere yayılıyor hem tek havuzu paylaşıyor. Üç Node süreci önüne bir yük
dengeleyici koyarak ölçüldüğünde tablo tersine dönüyor — havuzlar eşitlenerek (Java 30,
Node 3×10):

| Eşzamanlılık | Java (havuz 30) | Node ×1 (10) | Node ×3 (30) |
|---:|---:|---:|---:|
| 8 | 275 | 178 | 269 |
| 16 | 270 | 113 *(3422 hata)* | **316** |
| 24 | 200 | 57 *(5945 hata)* | **281** |

Yani sorun Node değil, tek süreç. Üç süreçle Java'yı yakalıyor, yük artınca geçiyor.

**Çok süreçli kurulumda `VS_AUTOSTART=0` şart.** Job katmanı her süreçte ayrı ayrı başlıyor:
üç süreç çalıştırıldığında `configWatch`, `cacheCleanup`, `errorTdWatch`, `poolPressure`
üçünde birden kayıtlı oldu. `errorTdWatch` aynı satırları üç kez raporlar,
`requestLogRetention` açıksa üç süreç aynı anda siler. Doğru kurulum: **yalnız bir süreç
job'ları çalıştırır**, diğerleri `VS_AUTOSTART=0` ile kalkar (doğrulandı: job sayısı 0,
endpoint'ler normal çalışıyor).

Her süreç kendi Oracle havuzunu açtığı için toplam bağlantı = süreç sayısı × `poolSize`;
veritabanının `sessions` sınırı buna göre ayarlanmalı.

**Pool eşiği — geçiş öncesi karar gerektiren madde.** `senddata`'da eşzamanlılık pool
boyutunu (10) aştığında bu servis kuyruğa almak yerine `-99 getConnection Err` dönüyor:
12'de %2, 16'da isteklerin %78'i. Java'nın Tomcat pool'u 10 sn bekliyor ve hiç istek
düşürmüyor, p95 yükseliyor. Roadmap risk #15'in ölçülmüş hâli; ayar parent projede
(`config/index.js` + framework `queueMax`).

Okuma tarafında normalize edilenler raporun başında listelenir — XML bildirimi, elemanlar
arası boşluk, vaka bazında değişken alanlar, iki Oracle sürücüsünün de eklediği yardım
bağlantısı ve `{call}` → `BEGIN…END;` dönüşümünün kaydırdığı ORA-06550 konumu.

## Java'dan bilinçli sapmalar

Servis Java'yı birebir taklit eder; aşağıdakiler bilerek ayrılan yerlerdir. Faz 9'daki `MINUS`
karşılaştırmasında **beklenen fark** olarak işlenir ve sürüm notuna girer. Gerekçelerin tamamı
`validator-migration-notlar.txt` içinde.

| # | Konu | Java | Node | Neden |
|---|---|---|---|---|
| 1 | Transaction | Yok, her INSERT kendi commit'i | Kayıt başına açık transaction | Bir kaydın tabloları arası tutarlılığı; roadmap §4 |
| 2 | Veri formatı hatasından sonrası | Gövdenin kalanı **hiç işlenmez**, cihaza OK | Kalan kayıtlar yazılır | Bir kayıt = parası alınmış gerçek bir yolculuk. Cihaz OK alınca gövdeyi bir daha göndermez, o yüzden Java'nın davranışı sessiz veri kaybı. Notlar [48] |
| 3 | `sendgps` eksik `MAIN_EVENT` | NullPointerException, tüm istek düşer | Kayıt normal yazılır | Notlar [15] |
| 4 | `getroute` LOB boş | `setMessage(-97)` sonrası NPE | `-97` dönülüp durulur | Notlar [11] |
| 5 | `getrouteinfodb?cache=1` | Stream kullanılmadan kapatılıyor, **her zaman** patlar | Dosya okunup döner | Notlar [37] |
| 6 | XML-RPC (`sendalarm`) | Timeout yok, takılan cihaz isteği süresiz tutar | 5 sn | Notlar [15] |
| 7 | Kesik gövde | `DocumentBuilder` SAXException atar | `XmlWalk.assertWellFormed` sezgisel kontrolü | xml-js kesik gövdeyi kabul ediyor; notlar [26] |

## Kafka üretimi (Faz 8)

Java `KkAvlProducer` + `KkKafkaConfigurator` → `util/KafkaProducer.js` (`kafkajs`, parent projeden).
Producer'lar `systemId + bootstrap` çiftine göre önbelleklenir; bir gönderim patlarsa o producer
atılır ve sonraki çağrı yenisini kurar — Java da öyle yapıyordu.

**Gönderim beklemez.** Java `producer.send(record, callback)` kaydı tampona bırakıp dönüyordu,
broker'ın cevabı yalnızca log'lanan bir callback'e gidiyordu. Broker onayını `await` etmek,
Java'nın OK döndüğü isteği düşürürdü; o yüzden burada da beklenmiyor. Bağlantı kurulumu ise
`kafka_producer_max_block_ms` ile sınırlı (Java'nın `max.block.ms` karşılığı).

Mesaj gövdesi Gson'un ürettiği belgeyle aynı şekilde kurulur: **null alan belgeye hiç girmez**
(`util/Gson.js`), alan sırası Java bean'inin tanım sırasıdır. Projeksiyonlar bean'lerde:
`toKafkaPayload()` / `toKafkaGpsPayload()` / `toKafkaCanPayload()`.

| Fonksiyon | Anahtar | Belge | Not |
|---|---|---|---|
| `senddata` (otobüs) | `sam_id` | `DataTransaction`, `type:"T"` | `latitude` ve `LATITUDE` aynı değeri taşır |
| `senddata` (istasyon) | `sam_id` | daha dar alan kümesi | konum, `path_code`, yakıt yok |
| `sendcfg` | `sam_id` | `CfgTransaction` | `validator_id` her zaman `pcb_id`'den gelir |
| `sendgps` GPSDAT | `sam_id` | `GpsTransaction` | saat kontrolünden **önce** üretilir |
| `sendgps` CANDAT | `bus_id` | aynı bean | Java tek nesneyi paylaştığı için son GPSDAT'ın alanları belgede kalır |
| `sendlog` | `bus_id` | `LogTransaction` | `scope` guard'ından **önce**, her eleman için |

| Anahtar | Tip | Varsayılan |
|---|---|---|
| `<func>_use_kafka_producer` | bool | `false` |
| `<func>_use_only_kafka_produce` | bool | `false` — açıkken DB yazımı atlanır, üretim devam eder |
| `<func>_kafka_error_throw` | bool | `false` — kapalıyken hata yalnızca log'lanır |
| `<func>_topic` | string | — |
| `kk_bootstrap_servers` | csv | — |
| `kk_bootstrap_servers_<func>` | csv | boşsa üsttekine düşer |
| `kafka_producer_retries` | int | `3` |
| `kafka_producer_max_block_ms` | int | `10000` |

`<func>` ∈ `senddata`, `sendcfg`, `sendgps`, `sendlog`.

## senddata'nın iki dış çağrısı

**Data-forward.** Kayıtlar yazıldıktan sonra `PK_CONFIG.FN_GET_TE_DATAFORWARD_URL` okunur; doluysa
ham gövde `<url>&systemid=<id>&lang=en` adresine POST edilir. Cevaptaki `result.code` 0 değilse
istek `-3 Ticket Engine Error: …` ile düşer. (Roadmap §15.5 bunu XML-RPC sanıyordu; değil, düz
HTTP + JSON — `util/HttpUtil.js` yeterli oldu.)

**Kredi kartı kullanım paketi.** `credit_card_type` listesindeki kartların biletleri gövde boyunca
biriktirilip `credit_card_data_url + addUsageEmvValidator` adresine tek belgede gönderilir
(`util/EmvUsageBatch.js`). Yalnızca otobüs yolunda (`ins_data`) çalışır. `key_index = 1` cihazın
ücreti kendi hesapladığı anlamına gelir ve atlanır; `server_environment = test` iken hepsi
gönderilir. Kart kredi kartıysa ama `ptcn` yoksa kayıt `101` ile düşer.

## Job katmanı (Faz 7)

Java'da yoktu. `VS_AUTOSTART=0` ile kapatılabilir (testler böyle çalışır).
Job anahtarları **yalnız `app` satırından** okunur — bir job tüm servis için bir kez çalışır,
kendine ait bir sistemi yoktur.

| Job | Periyot anahtarı | Varsayılan | Durum |
|---|---|---:|---|
| `configWatch` | `config_refresh_ms` | 5 dk | açık |
| `cacheCleanup` | `cache_cleanup_interval_ms` + `cache_max_age_ms` | 1 sa / 1 gün | açık |
| `errorTdWatch` | `error_td_watch_interval_ms` | 5 dk | açık |
| `poolPressure` | `pool_pressure_interval_ms` | 1 dk | açık |
| `sqliteRefresh` | `sqlite_refresh_interval_ms` + `sqlite_refresh_systems` | 30 dk | **kapalı** (liste boş) |
| `requestLogRetention` | `retention_interval_ms` + `request_log_retention_days` + `error_td_retention_days` + `retention_batch_rows` | 1 sa / 0 gün / 5000 | **kapalı** (0 gün) |
| `kpgHealth` | `kpg_health_interval_ms` + `kpg_health_url` + `kpg_health_timeout_ms` | 5 dk / — / 5 sn | **kapalı** (URL boş) |

Kapalı olan üçü `register()` içinde `null` döner, konsol listesinde görünmez.
İlk koşuşlar 15 sn adımlarla kaydırılır (`STAGGER_STEP_MS`) — `queueMax=1` pool'larda
açılışta üşüşmemek için.

`?func=getjobs` hepsini listeler (kayıtlı olmayanlar `registered:false` ile),
`?func=reloadconfig` KKCONFIG'i yeniden okur ve job'ları yeniden bağlar.

## Konfigürasyon okuma

Dispatcher config'i **bellekten** okur (`system_cfg.cfgs`), Java `EnvConfig` gibi.
`configWatch` 5 dakikada bir tazeler; anında etki için `?func=reloadconfig`.
Bir config değişikliği en geç bir `config_refresh_ms` sonra istekleri etkiler.

## İstek logu

`save_request_log_functions` listesindeki fonksiyonlar gövdeyi `VALIDATOR_REQUEST_LOG`
tablosuna yazar. Satır **ayrı commit** edilir (autocommit), yazım hatası isteği düşürmez.
`*_use_only_kafka_produce` açık olan fonksiyonda log atlanır — Java da öyle yapıyordu.

## SQLite dosya üretimi (Faz 6)

`getrouteinfodb` ve `generatefreecardsqlite` cihaza indirilen `.db` dosyalarını üretir.
Sürücü **`node:sqlite`** — bağımlılık yok, Node 22.5+ gerektirir (Docker imajı `node:24`).

| Konu | Karar |
|---|---|
| Akış | Oracle'dan oku (await) → bellek içi db'ye tek blokta yaz → `backup()` ile dosyaya kopyala |
| Dosya adı | `<yyyyMMdd>_local_.db`, `ValidatorServiceRouteDbFile/` ve `ValidatorServiceFreeCardDbFile/` altında |
| `?cache=1` | Bugünün dosyası varsa o döner; `cache=0` veya parametre yoksa her zaman yeniden üretilir |
| WAL | **Açılmaz.** `-wal`/`-shm` dosyaları oluşur ve cihaza giden `.db` eksik kalırdı |
| DDL yazım hataları | `MUMERIC(4)` / `NUMBERIC(3)` **aynen korundu** — SQLite kolon affinity'sini tip adının yazılışından belirliyor |

## Faz 5 ile gelen konfigürasyon anahtarları

`KKCONFIG.VALIDATOR_SERVICE_CONFIG` içindeki JSON'a eklenir.

| Anahtar | Tip | Varsayılan | Satır | Açıklama |
|---|---|---|---|---|
| `credit_card_auth_url` | string | `""` | sistem → app | `realauth` / `sendemvdata` için KPG adresi |
| `credit_card_type` | csv veya dizi | `["11"]` | sistem → app | Kredi kartı tipleri; `transfer_ref_code="sync"` bunlara yazılır |
| `kpg_connect_timeout_ms` | int | `30000` | **yalnız app** | Java `EnvConfig.getSystemConfig("app")` ile aynı |
| `kpg_read_timeout_ms` | int | `60000` | **yalnız app** | |
