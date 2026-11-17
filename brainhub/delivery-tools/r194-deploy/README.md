# R194 Windows teslim akışı

Bu klasör yalnız teslim araçlarıdır. Kurulacak uygulama adayı sabit kalır: **97bc7b619f82f719b8042e68bd545bdd58832904**, ağaç **f3442de625647d986fd7d6bb098cd4cf7dfc5b71**. Taban R193: **27f09a041d5d5d3b8a85d53c6cf4e8037864bd6d**. Bu araçların commit'i uygulama adayı olarak kullanılmaz. R194'ün mevcut Windows kabulünü değişmiş bir aday gibi göstermeyin.

Tam teslim ZIP'i; bu dört dosya, R194 bundle, `TESLIM.json`, `Start-IsolatedWindowsAcceptance.ps1` ve salt okunur teşhis aracını içerir. Tek tek PS dosyalarını C:\JEV-Brain üzerine kopyalamayın.

Kullanım: ZIP'i ayrı klasöre çıkarın; `JEV-R194-KUR-VE-DEPLOY.cmd` dosyasını sağ tık → Yönetici olarak çalıştırın. PC'deki Codex'in veya Claude'un kredi/model bağlantısı kullanılmaz. Mevcut `JEV-TEST-DEPLOY.ps1` motoru CANLI açıkken kendi yazılı CANLI onayını ister; açık pozisyonda veya pozisyon listesi okunamazken kurulum yapmaz. Önceden kapalı CANLI kendiliğinden açılmaz.

Akış:

1. Teslim hash'leri, Node 24, beklenen kaynak, kurulu kritik dosyalar ve 16 yalıtılmış teslim sınaması kontrol edilir.
2. Aynı commit ve Node sürümü için son gerçek Windows kabulü kullanılır. Daha yeni başarısız koşu varsa eski geçişe geri düşülmez. Geçerli kanıt yoksa bot çalışırken ayrı kaynak kopyasında native PowerShell 5.1 kabulü çalıştırılır. Hata varsa kaynak aktarımı ve durdurma başlamaz.
3. Temiz, beklenen source yalnız fast-forward ile ilerler. İki kök PS betiği ve BEKLENEN-SURUM yerel yedekle eşleştirilir. common.ps1 doğrulanır ama değiştirilmez. Kaynaktaki eski CMD şablonları kopyalanmaz. Kirli kaynak, değiştirilmiş kök betik veya farklı sürüm zorla düzeltilmez. Aktarım, runtime kurulumu değildir.
4. Mevcut JEV-TEST-DEPLOY motoru çalışır. Sonrasında sekiz kritik kurulu dosya, gerçek Office/çekirdek sürümü, hat seçimleri, ayar dosyaları ve önceki armed/mod durumu doğrulanır. Hata varsa gerçek aşama açıklanır; başarı mesajı verilmez. Öğrenim dosyaları bu teslim aracı tarafından taşınmaz, sıfırlanmaz veya değiştirilmez.
5. Downloads altında DEPLOY-SONUC.json, gerçek Windows kabulü, TAP ve ek salt okunur teşhis içeren sonuç ZIP'i oluşturulur.

Sınamalar: Linux PowerShell 7.7 üzerinde 16/16; gerçek geçici Git depoları ve sahte runtime/ayar/öğrenim dosyalarıyla çalıştırıldı. Kopyalama ve fast-forward hata senaryolarında kök dosya geri dönüşü sınandı. Gerçek CANLI erişimi, borsa emri, model çağrısı veya ağ kullanılmadı. Bu sonuç native Windows kabulü ya da gerçekleşmiş deploy değildir. Paket kendi Windows öz sınamasını da geçmeden ilerlemez.

R194 uygulama paketi önceki 1540 testlik aynı adaydır; bu araçlar giriş/ret politikasını veya APK'yı değiştirmez. APK dalı yalnız mevcut deploy'un beklediği HEAD ve temizlik koşulları açısından okunur; güncellenmez. JEV retlerinin hunide sonuç yok görünmesi ayrı takip kusurudur ve R194'te düzeltilmiş sayılmaz.

## 18 Kasım teslim sınaması düzeltmesi

Kullanıcının Windows PowerShell 5.1 raporunda teslim öz sınamaları 15/16 kaldı; sourceStaged=false ve deploymentInvoked=false. Son sınama, zaten CRLF olan kaynak metninde LF→CRLF işlemi yapıp CRCRLF üretiyordu. Bu hata `core.autocrlf=true` komut ortamıyla Linux PowerShell'de de 15/16 olarak yeniden üretildi. Düzeltilen sınama önce kanonik LF metni oluşturur; sonra LF ve CRLF biçimlerinin her birini UTF-8 BOM var/yok olarak ayrı kurar. Dosya karması doğrulaması gevşetilmedi, sınama atlanmadı, uygulama adayı 97bc7b6 değişmedi.

Yüklenen gerçek Windows uygulama kabulü: aynı 97bc7b6, PowerShell 5.1.26100.9818, Node v24.16.0, 1540/1540, hata/atlama yok. PC devir kaydı source HEAD'in R193 tabanında kaldığını ve program anlık görüntüsünün değişmediğini bildiriyor. Bu, R194'ün kurulduğu anlamına gelmez. Yenilenen teslim sınamasının native Windows sonucu yeni koşuda doğrulanacak.
