# Antik Harita Türkiye

Android için kaynaklı tarih coğrafyası ve kültür varlığı koruma atlası.

## v16 ATLAS

v16 arayüzü sıfırdan yenilendi. Uygulama harita hareketlerinde canlı arkeoloji/POI sorgusu yapmak yerine derleme sırasında üretilen kaynaklı bir tarih korpusunu APK içine alır.

### Arayüz
- Üstte tarihî ad + modern yer araması.
- Dönem, tarihî unsur türü, konum doğruluğu ve harita zemini filtreleri.
- Uzak görünümde kümeler; yakın görünümde kayıt adları.
- Kaynakta mevcut çizgi/poligon geometrilerinin gösterimi.
- Yakındaki kayıtları harita merkezine göre sıralayan liste.
- Cihazda saklanan favoriler.
- GPS konumu ve Android harita uygulamasında açma desteği.
- Güncel OSM zemini ile OpenHistoricalMap tarihsel zemin arasında geçiş.
- Kamuya açık kayıt yoğunluğundan türetilen yaklaşık bölgesel koruma bağlamı.

### Veri
- Kaynaklı korpus: Pleiades GIS export.
- Türkiye ve yakın tarihsel çevre için derleme zamanı filtreleme.
- Sınıflar: yerleşim, yol/güzergâh, han-kervansaray/konaklama, savunma, köprü-geçit, su, yayımlanmış mağara/sığınak, mezar/nekropol, dini yapı ve diğer tarihî yapı/alan.
- Dönemler: Neolitik, Kalkolitik, Tunç Çağı, Hitit, Frig, Urartu, Arkaik, Klasik, Helenistik, Roma, Bizans, Selçuklu ve Osmanlı.
- Kayıt kartları mümkün olduğunda alternatif adları, dönem bilgisini, kaynak türlerini, provenansı ve Pleiades konum hassasiyeti/accuracy bilgisini gösterir.
- `precise`, `rough` ve geometri varlığı doğrudan filtrelenebilir.

## Arama

Arama önce APK içindeki tarihî/ad varyantı korpusunu tarar. Modern il/ilçe/köy/mahalle araması gerektiğinde Android katmanı üzerinden Nominatim kullanılır ve sorgu Türkiye ile sınırlandırılır.

## Koruma ilkesi

Uygulama yayımlanmamış/gizli kültür varlığı, define veya saklama hedefi üretmez. `◌` katmanı yalnız kamuya açık, kaynaklı tarihî kayıtların geniş bölgesel yoğunluğunu yaklaşık alanlar halinde gösterir. Pleiades tarafından `rough` olarak işaretlenen koordinatlar kesin konum kabul edilmez.

## Derleme

Hem GitHub Actions hem Codemagic önce `tools/build_history_dataset.py` betiğini çalıştırır. Betik Pleiades GIS CSV dosyalarını indirir ve `app/src/main/assets/data/history-corpus.json` dosyasını üretir. 500 kaydın altında sonuç oluşursa veya v16 arayüz dosyası beklenmedik biçimde eksikse derleme durur; demo/boş APK üretilmez.

GitHub Actions çıktısı: `antik-harita-turkiye-v16-atlas-debug-apk`.
