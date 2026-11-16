# Windows kabul ve deploy teslimi

Bu ek, `58eb8dcc2c3e9364583793997e4d15baaddbbf28` kaynak adayinin uzerine gelir. Onceki VERIFICATION.json o kaynak testlerinin kaydidir; bu ekin Windows kabul sonucu degildir.

`WINDOWS-KABUL.cmd`, Windows PowerShell 5.1 ve Node 24 ile yalniz izole bilesen kabulunu calistirir. Canli PC'yi durdurmaz, kurulum yapmaz, hat acmaz, anahtar istemez ve gercek hesapla baglanti kurmaz. Alt test surecine canli uygulama ortam degiskenleri/anahtarlar aktarilmaz; dis ag ve kurulu botun 8787/8788/8790 portlari engellenir. Sahte verilerle tam Node test grubu, gercek deploy pozisyon okuyucusunun hatali/eksik yanit davranisi, yerel DPAPI sahte deger turu ve PowerShell soz dizimi kontrol edilir.

Windows disinda veya eksik/basarisiz test varsa `WINDOWS_COMPONENT_ACCEPTANCE_FAILED` yazar. Windows'ta tum kontroller gecerse `WINDOWS_COMPONENT_ACCEPTANCE_PASSED` yazar. Bu raporda `productionReady` yine false kalir: kullanicinin kurulu programi, Office ekrani, guncel hesap/emirler, kaynak/dagitim dosyasi eslesmesi ve restart kabulunun ayrica kanitlanmasi gerekir.

GitHub workflow'u `jev-windows-acceptance.yml`, bu teslim dalina push ile Windows runner istemektedir. Runner/billing engeli, workflow baslatma veya job olusmasi testlerin gectigi anlamina gelmez. Yalniz gercek adim sonucu ve kabul raporu kanit sayilir. Kaynaklara uretilmis sahte bir Windows BASARILI raporu eklenmez.

Ek guvenlik duzeltmesi: `common.ps1 / Open-Positions`, ok=false, ledgerOk=false, eksik/null/metin turunde liste, hatali pozisyon satiri veya 90 saniyeden eski/gelecek tarihli defteri sifir pozisyon gibi yorumlamaz. Yalniz ok=true, ledgerOk=true, guncel tarih ve dogrulanmis bos dizi sifir kabul edilir. Yerel ust-kok common.ps1 de bu teslimden alinmadikca eski deploy okuyucusu degismis sayilmaz.

Bu ortamda Windows PC baglantisi yoktur. Linux uzerinde PowerShell 7 ile tum kaynak betikleri parse edildi ve gercek pozisyon on kontrolu mock yanitlarla calistirildi; bunlar Windows PowerShell 5.1/DPAPI kabulunun yerine gecmez. Windows kabul betiginin Linux'ta BASARISIZ raporu urettigi de dogrulandi.

`JEV-TEST-DEPLOY.cmd` teslimi icin zorunlu son kapilar:

1. Windows bilesen kabul raporu gecmeli ve raporun kaynak commit'i kurulacak kaynakla eslesmeli.
2. PC'deki kaynak temizligi, mevcut BEKLENEN-SURUM.txt ve son AGENTS/CLAUDE devir kurallari okunmali; baska gelistirme ezilmemeli.
3. Kaynak ile ust-kok JEV-DEPLOY.ps1/common.ps1 ve beklenen commit dosyasi ayni teslime alinmali; iki yeni JS modulunun kurulum/hash listesi korunmali.
4. Guncel hesap/normal-kosullu emirler ve geri donus/yedek durumu dogrulanmali. Pozisyon durumu bilinmiyorsa sifir denmemeli. Acik gercek pozisyon korumasi asilmaz.
5. Kullaniciya ait CANLI baslatma/onay adimi korunmali. Kurulumdan sonra kaynak commit'i, runtimePatch, Office surumu ve secili hatlar tekrar dogrulanmali.

Bu bes maddeyi tamamlanmis gibi gostermek icin kaynak testi veya eski ekran kullanilmaz.
