# Antik Harita Türkiye

Android için kaynaklı tarih coğrafyası ve kültür varlığı koruma haritası.

## v15 RESEARCH yaklaşımı

Bu sürüm önceki canlı Overpass/Wikidata merkezli POI mantığını kaldırır. Haritada dolaşırken her hareket için uzak sorgu yapılmaz. Codemagic derleme aşamasında Pleiades GIS dışa aktarımından Türkiye ve yakın tarihsel çevresi için bir yerel araştırma korpusu üretilir; APK bu korpusu cihazdan okur.

### Harita ve veri
- Güncel zemin: OpenStreetMap, yalnız modern konum/orientasyon için.
- Tarihsel zemin: OpenHistoricalMap vektör haritası; seçilen dönem için `start_decdate` / `end_decdate` alanlarıyla tarih süzme uygulanır.
- Kaynaklı kayıt korpusu: Pleiades GIS export.
- Kayıt sınıfları: yerleşim, tarihî yol/güzergâh, han-kervansaray/konaklama, savunma, köprü-geçit, su, yayımlanmış mağara/sığınak, mezar/nekropol, dini yapı ve diğer tarihî yapı/alan.
- Dönemler: Neolitik, Kalkolitik, Tunç Çağı, Hitit, Frig, Urartu, Arkaik, Klasik, Helenistik, Roma, Bizans, Selçuklu ve Osmanlı.
- Her kayıt mümkün olduğunda alternatif adlar, dönem bilgisi, kaynak türleri, provenans ve Pleiades konum hassasiyeti/accuracy bilgisi taşır.
- Uzak görünümde kümeler; yakın görünümde kayıt adları ve kaynakta mevcutsa çizgi/poligon geometrileri görünür.

## Arama

Arama önce APK içindeki tarihî/ad varyantı korpusunu tarar. Modern il/ilçe/köy/mahalle araması gerektiğinde Nominatim üzerinden Türkiye ile sınırlandırılmış arama yapılır.

## Koruma bağlamı

`◌` katmanı yalnız kamuya açık, kaynaklı tarihî kayıtların geniş bölgesel yoğunluğunu gösterir. Gizli/yayımlanmamış arkeolojik noktalar, define/saklama hedefleri veya kazı optimizasyonu üretilmez. Kaynakta `rough` olarak işaretlenen koordinatlar kesin konum kabul edilmez.

## Derleme

Codemagic `tools/build_history_dataset.py` betiğini çalıştırır. Betik Pleiades GIS CSV dosyalarını indirir, Türkiye ve yakın çevre için kaynaklı korpusu oluşturur ve `app/src/main/assets/data/history-corpus.json` dosyasına yazar. 500 kaydın altında sonuç oluşursa demo/boş APK üretmek yerine derleme durur.
