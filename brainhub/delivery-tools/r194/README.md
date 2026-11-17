# R2544.194 — giriş kanıtı ve salt okunur teşhis

R193 tabanı: `27f09a041d5d5d3b8a85d53c6cf4e8037864bd6d`. Bu klasörün varlığı PC’ye kurulum yapıldığı anlamına gelmez.

## Doğrulanan kod sorunları

1. İlk 3 v2 ve ZİRVE-5 için hesaplanan sayısal referans giriş/stop/hedef, v2 için azami süre ve bazı giriş gözlemleri JEV’in gerçek istek kaydında yoktu. Talimat ise gönderilmeyen `features.ind` / `features.experience` alanlarını okumasını istiyordu. Controller’daki geçerli plan şimdi `record.proposedPlan` altında, hesaplanmış indikatör/giriş bağlamı/öğrenim ve uyarılar `record.entryFeatures` altında gider. Plan sinyal mumunun referansıdır; gerçek dolum veya emir değildir. Emir yolu kendi mevcut güvenlik kontrollerini ve güncel fiyattan hesaplamasını korur.
2. İlk 3 v2 metni, güncel ayarlar bazı kontrolleri uyarı olarak geçirirken eski sert kuralların uygulanmış olduğunu söylüyordu. Güncel aday ile tarihsel araştırma örneği ayrıldı. Yeni işlem kuralı veya otomatik onay eklenmedi.
3. KB sıkıştırıcısının koruma özeti, yalnız giriş kaydı bulunan pakette boş olabiliyordu; giriş kaydının içindeki sayısal geometri hedef alınabiliyordu. Üç giriş sözleşmesinin kaydı artık korunan gerçeklere dahildir. 48.000 UTF-8 bayt tavanı yükseltilmedi. Sığmayan zorunlu veri sessizce silinmez; açık boyut engeli kaydedilir.
4. R192 düzeltmesine rağmen deploy betiğinin “önceden de CANLI kapalıydı” dalı hâlâ yalnız kurulla başlatma öneriyordu. Bu bilgi satırı önceki JEV + Kurul düzenini açıklayan ortak ipucuna bağlandı. Betik kendiliğinden kapalı CANLI’yı açmaz.

Bunların 14 gerçek ret veya gerçekleşmiş zararların nedeni olduğu kanıtlanmadı. Güncel PC kapıları ve JEV’in tarihsel tam isteği bu ortamda görülemedi. R193’te yalnız boyut günlüğü, geçmiş 14 isteğin tam gövdesini yeniden kurmaya yetmez.

## Davranış ve kayıt

- JEV’in gerçek `REJECT_ENTRY` yanıtı bağlayıcı kalır; İlk 3 ve Z5 sınamalarında emir açma yoluna ulaşmaz.
- Ekran kapısı, hesap okuma, marj/kaldıraç/hat seçimleri ve canlı yetkisi değişmedi. KEŞİF pusu ikizine yetki verilmedi, kapalı TEPE SHORT açılmadı. Runtime öğrenimleri veya kullanıcı ayarları bu geliştirme kopyasına alınmadı.
- Yeni giriş istekleri `runtime/logs/entry-decisions/<kimlik>.json` içinde hazırlanmış gövde, SHA-256, boyut, yerel durum ve yanıtla ilişkilendirilir. `PREPARED`, `PREFLIGHT_BLOCKED`, `BUDGET_BLOCKED`, `ATTEMPTED`, `REPLIED`, `NO_RESPONSE` ayrıdır. Başlıklar/API anahtarı yazılmaz. Kayıt yazılamaması JEV kararını değiştirmez. Bu kayıtlar ek model çağrısı veya emir üretmez.
- APK kaynak dalı `e9b6487d1590a31f07e7645999c98f7e984aca92`, sürüm etiketi 9.5.145. Bu PC değişikliği mobil sözleşmeyi değiştirmiyor. APK derlenmedi, imzalanmadı, telefonda kurulmadı; yüklü telefon sürümü doğrulanmadı.

## Teşhis aracı

`JEV-TESHIS.cmd`, PC’de mevcut Node 24 ile `collect-diagnostics.cjs` çalıştırır. Son 24 saatten en çok 3000 seçili defter olayı, sınırlı günlük kuyrukları, hat ayarları, güncel taramalar/kapılar ve program karmaları toplanır. Z5 durumu gerçek konumu olan `top3-hunter-state.json.z5` içinden, KEŞİF kararları `sozRecent` içinden de alınır. Office’e yalnız bir yerel GET yapılır; borsaya veya modele çağrı yapılmaz. Kimlik bilgileri çıktıda maskelenir; DPAPI ve auth.json dosyaları okunmaz. Çıktı Downloads altında oluşturulur; çalışma dosyaları değişmez. Windows’ta ZIP üretimi henüz bu ortamda sınanmadı. Erişim reddi ve kilitli dosyalar hata olarak kaydedilir, sahte sıfır sonuç sayılmaz.

## Doğrulama ve teslim sınırı

Linux Node 24 tam paket: 1540 test, 1539 geçti, 0 hata, 1 Windows DPAPI sınaması atlandı. Ağ ve kurulu PC dosyalarına erişimi engelleyen mevcut kabul koruyucusu ile ayrıca koşuldu. PowerShell 7.7 ayrıştırıcısında 45 betikte sözdizimi hatası yok; bu sonuç native Windows PowerShell 5.1 kabulü değildir. Gerçek R193 modülüyle üç yeni davranış sınaması da başarısız oldu; düzeltilmiş modülde geçer. Doğrulama karmaları `VERIFICATION.json` içindedir.

Teslim sırası: güncel PC teşhisi → aynı aday commit’inde yalıtılmış Windows kabulü → source/BEKLENEN/root betik eşliği → mevcut `JEV-TEST-DEPLOY.cmd` ile kurulum → sürüm/hat/başlatma kabulü. Henüz Windows kabulü veya R194 deploy’u yapıldı denemez. Kabul başarısızsa veya source arada ilerlediyse zorla aktarım yapılmaz.

Açık işler: güncel hiç giriş olmamasının kapı bazında teşhisi; İlk 3 gecikmesinin aşama ölçümü; BTW hesap okuma hatasının gerçek hata kaydı; hook code 1; JEV öğrenimlerinin başka PC’ye kontrollü taşınması ve Setup.exe. `PAKETLE.cmd` bunların öğrenim taşımasını kanıtlamaz.
