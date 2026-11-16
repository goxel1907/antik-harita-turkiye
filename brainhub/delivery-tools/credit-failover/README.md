# JEV kredi bittiğinde kurul yedeği — 16 Kasım 2026

Durum: R2544.183 (`bfe728a09dc1c436869f7066baddd0c03dfb2323`) üzerine hazırlanmış ayrı kaynak adayıdır. Çalışan Windows PC'ye uygulanmamıştır. Runtime release uyumluluk etiketi R2544.183 kalır; bu adayı ayırt eden `/health` ve `/live/status` alanı `runtimePatch: CODEX_CREDIT_FAILOVER_20261116` ve ayrı kaynak commit'idir. `BEKLENEN-SURUM.txt` değiştirilmemiştir. Kullanıcının R183 kurulu/CANLI yeniden başladı beyanı uzaktan canlı kontrol yapılmış gibi sunulmaz.

## Uygulanan davranış

- Normal 5 dk / 15 dk PASS-1, PASS-2 ve açık pozisyon yönetimi ile Vur-kaç ön yetkisi/çıkışı için JEV HTTP 402 veya günlük çağrı bütçesi tükenince bağlı kurul yedek olur. Ücretli başka bir model seçilmez; mevcut kurul üyeleri kullanılır. Kurul sağlayıcılarının kalan kotası/maliyeti bu çalışmada canlı sorgulanmadı; yedek maliyeti sıfır kabul edilmez.
- Aynı sınırlandırılmış piyasa paketi ve seçenekli soru sözleşmesi kullanılır. Üç koltuk istenir; en az iki farklı üyeden ve yanıt veren takımın yarısından fazlasından tüm seçimlerde aynı, tam teklif gerekir. Stop/TTL/kaldıraç/yönetim seçeneklerinden karma bir emir planı oluşturulmaz. Asıl şema ve anlamsal tutarlılık kontrolleri ayrıca çalışır.
- Kurul cevap vermezse yeni giriş yetkisi üretilmez. Mevcut borsa stopları ve yürütme güvenlikleri devrededir; cevap yokluğu yeni bir çıkış emri değildir. 401/403, bozuk anahtar, bozuk bütçe kaydı veya paket bütünlüğü hatası bu yoldan aşılmaz.
- HTTP 402 sonrası beş dakika JEV tekrar denemesi bekletilir; sonra ilk gerçek karar çağrısı JEV'i yeniden dener. Başarılı olursa öncelik JEV'e döner. Günlük sınır ve kullanıcı tercihleri artırılmaz.
- Göxel'in mevcut kodla üretilen giriş/pozisyon gözlemleri JEV ve kurul için yalnız danışman kanıtıdır. Normal/Vur-kaç'a yeni bağımsız Göxel emir yetkisi veya zarar gölgesine işlem yetkisi verilmez. Özgün giriş/fiyat/stop bilgisi ya da grafik yoksa bu açıkça yazılır. Danışman verisi en fazla 2,5 saniye beklenir; iki eşzamanlı toplama ve kısa önbellek kaynak kullanımını sınırlar.
- İlk 3/ZİRVE-5/KEŞİF-SÖZ mevcut masa yedeğinde Göxel ve giriş notları artık kurula da gider. Bu hatların giriş kuralları ve yetki seçimleri değiştirilmez.
- Karar sahibi `decisionOwner`, üye kimlikleri, istek kimliği, teklif/paket özeti ve devralma nedeni ayrı kaydedilir. Eski `jev*` API alan adları uyumluluk için korunur; bu alan adları kararın JEV'den geldiğinin kanıtı değildir.
- Eksik tarihî `weak` verisi artık otomatik söz sahibi sayılmaz. Ham tarihî defter ve kaydedilmiş açıklamalar topluca yeniden yazılmaz; düzeltme alanlardan açıklama üretilen yoldadır.
- Yeni modüller `manage.ps1` kurulum listesine ve deploy hash çıktısına eklendi. Office kredi/bütçe uyarıları bağlı yedek ile verilmiş karar arasındaki farkı gösterir.

## Değişmeyen tercihler ve açık işler

Hiçbir hat açılmadı; CANLI/armed, marj, kaldıraç, strateji, API anahtarları, gerçek emirler ve öğrenim kayıtları değiştirilmedi. Vur-kaç'ın mevcut seçim/Normal sistem bağımlılığı ve CANLI izin koşulları korunur. Yeni APK yapılmadı. Kullanıcının APK KEŞİF-SÖZ kontrolü ve bölüm aç/kapa isteği ayrı açık iştir.

Setup.exe, farklı hesaplarla ilk kurulum ve şifreli öğrenim taşıma projesi unutulmadı. Kullanıcının PC'sindeki `ENVANTER-2026-11-16.md`, `kurulum.iss`, `GUNCEL-DURUM.md`, `PROJE-HARITASI.md`, `URUN-GEREKSINIM-SETUP.md` ile CODEX/Claude devir raporları burada bulunmadığı için güncellenmiş sayılmaz. Kurulum taslağı çalışan Setup.exe veya temiz PC kabulü değildir. Bu dal o ürünü tamamlamaz.

Zararların kök nedeni ve kârlılık bu değişiklikle kanıtlanmış değildir. TEPE SHORT karşılaştırmasında yönetimin geride kalması ayrı ölçüm konusudur. Bu teslimin amacı karar yolu ve ekran/kayıt doğruluğudur.

## Doğrulama

Node v24.22.1 üzerinde izole geçici dosyalar, taklit hesap/model cevapları ve dış ağ engeli kullanıldı. Gerçek JEV, kurul veya Binance çağrısı yapılmadı. Yerel HTTP test sunucularına izin verildi. Test komutu:

```sh
NODE_OPTIONS="--require=$PWD/brainhub/delivery-tools/credit-failover/no-network.cjs" node --test --test-concurrency=4 brainhub/test/*.test.js
```

`os.tmpdir()` erişilebilir değilse TMPDIR'ı yazılabilir izole bir test dizinine ayarlayın. Önceki testte iki çevre/sabit metin varsayımı bulundu: deploy testi kaynak yerine geliştirici PC kökünü okuyordu; export testi işlevi çağırmak yerine kaynakta bitişik isim arıyordu. Kaynak deploy dosyasını ve gerçek dışa aktarılmış işlevleri kontrol edecek şekilde düzeltildi. Windows DPAPI testi bu ortamda atlanır; Windows kurulumu, Office görsel kabulü ve gerçek hesapta karar etkisi doğrulanmış değildir.

## Windows'a aktarım sınırı

Yerel kaynak temizliği, geçerli beklenen commit ve kullanıcıdaki son devir kuralları PC'de yeniden okunmadan ana kaynağa aktarılmamalı. Bu aday körlemesine `main` üstüne yazılmamalı; yeni bir kaynak/teslim sürümü olarak mevcut güncelleme akışına alınmalıdır. Açık gerçek pozisyon varsa mevcut deploy koruması aşılmaz. Kullanıcının seçtiği giriş noktası `JEV-TEST-DEPLOY.cmd`; bu wrapper `JEV-DEPLOY.ps1` içindeki program güncelleme/restart işini çağırır ve CANLI'ya dönüşü kendi kurallarıyla yönetir.

Windows PC bağlantısı bu oturumda yoktu. Kendi Linux çalışma ortamımızı kullanıcının PC'si, kaynak testlerini canlı kabul veya bu dosyayı Windows devir notu gibi göstermiyoruz.
