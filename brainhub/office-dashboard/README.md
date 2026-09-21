# BrainHub Trade Office (salt-okunur izleme ekranı) • v1.1.0-CLAUDE-V109

> CLAUDE_V109: Bu ekran Claude (Anthropic, Cowork) tarafından yazıldı ve v9.5.109-CLAUDE ile güncellendi.
> v9.5.109-CLAUDE PC güncellemesi (`UPDATE.ps1`) bu klasörü otomatik olarak `C:\BrainHub\office-dashboard` içine kopyalar;
> ekranı başlatmaz, Brain Hub'a gömülmez.

### v1.1 yenilikleri
- **Yürüyen trader'lar:** her veri rotasında bir trader elinde kartla yürür (ör. `PTB • 9 grafik`, `16 aday`, `QUALIFIED 2`);
  kart gidişte dolu, dönüşte boştur. Tıkalı kapıda trader **bekler** ve kartında `✕ 0 aday`, `✕ LIVE kapalı` yazar.
- **Karar odası:** beynin çevresinde üç trader takip edilen setupları (`PTB WATCH 15m>0.0412`) beyne taşır.
- **Claude v9.5.109 gölge ölçüm paneli:** kod-tetik “QUALIFIED olurdu”, sayısal tetikli plan, gölge tetik ve 15/60 dk sonuç,
  24 saat kanıt sayacı, Jev v108 kuralı ↔ Claude rol-ağırlıklı kural karşılaştırması, kovalama kapısı.
- **Setup tablosu:** sayısal tetik sütunu (`15m > 0.0412`, ✓ = gölge tetik gerçekleşti).
- `-Sim` seçeneği: v109 panellerini **uydurma** sayılarla gösterir (üst bantta SİMÜLASYON yazar).
- Hareket azaltma: işletim sistemi “animasyonları azalt” ayarındaysa yürüyüş durdurulur.

Brain Hub'ın beynini, görsel analistini, plan worker'larını, ücretsiz modelleri, Jev hakemini, risk ve yürütme masasını
tek ekranda **canlı ve animasyonlu** gösterir. Emir göndermez, ayar değiştirmez, Brain Hub'ı yeniden başlatmaz.

## Kurulum (tek sefer)
1. Bu klasörü `C:\BrainHub\office-dashboard` olarak kopyala (zip'i oraya çıkar).
2. `C:\BrainHub\office-dashboard\OFFICE.cmd` dosyasına çift tıkla  
   veya PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\BrainHub\office-dashboard\START-OFFICE.ps1`
3. Tarayıcıda `http://127.0.0.1:8790/` açılır.

Seçenekler:
- `-Demo` → Brain Hub'a bağlanmadan 21 Eylül ekran görüntülerindeki gerçek sayılarla açar (üst bantta **DEMO** yazar).
- `-Sim` → v9.5.109-CLAUDE panellerinin görünümü için **uydurma** simülasyon verisi (üst bantta **SİMÜLASYON** yazar).
- `-Tailnet` → Telefondan açmak için Tailscale üzerinden `https://<pc-adı>.ts.net:8790/?key=...` yayını açar.
  Anahtar `office-key.txt` içinde saklanır ve adres panoya kopyalanır. Kapatmak: `STOP-OFFICE.ps1 -Tailnet`.
- Durdurmak: `STOP-OFFICE.ps1` (yalnız bu ekranın node sürecini kapatır).

## Veri kaynakları (hepsi okuma)
| Kaynak | Ne okunur | Sıklık |
|---|---|---|
| Brain Hub `127.0.0.1:8787` | `/health`, `/live/status`, `/vision/progress`, `/journal?limit=80`, `/models/healthy`, `/live/account` | 2,5–30 sn |
| `C:\BrainHub\logs\brainpub.log` | son ~96 KB (olay akışı) | 8 sn |
| `C:\BrainHub\data\jev-usage.json` | Jev günlük sayaç | 15 sn |
| `C:\BrainHubBackups` | yedek klasör listesi | 60 sn |
| Ollama `127.0.0.1:11434/api/ps` | yüklü görsel model / VRAM | 10 sn |
| 9Router `127.0.0.1:20128` | erişilebilirlik | 30 sn |

Güvenlik:
- Brain Hub'a yalnız izin listesindeki GET yolları çağrılır (`ALLOWED_BRAIN_PATHS`). POST/PUT yoktur.
- Brain Hub eşleştirme token'ı (varsa) `config\client-token.dpapi` dosyasından Brain Hub'ın kendi yöntemiyle okunur,
  yalnız bu sürecin belleğinde tutulur, tarayıcıya **gönderilmez**. Yanıtlardaki `key/secret/token` alanları silinir.
- Sunucu varsayılan olarak yalnız `127.0.0.1` dinler. Tailnet modunda erişim anahtarı zorunludur.
- `/live/account` Binance'e imzalı GET atar (30 sn önbellek). İstemezsen: ortam değişkeni `OFFICE_ACCOUNT=0`.

## Ekran
- **Ofis katı:** her masa bir görev: Tarayıcı, Görsel Analist (GPU), Plan Worker'lar, OpenRouter Free, BEYİN, JEV Hakem,
  Risk Masası, Yürütme/Binance, Pozisyon Yöneticisi. Ekran rengi: mavi=çalışıyor, yeşil=başarılı, sarı=uyarı, kırmızı=engelli.
  Mavi paketler veri akışını, kırmızı ✕ kapılar hattın tıkandığı yeri gösterir (QUALIFIED → Jev → Niyet → LIVE/Emir).
- **Neden işlem yok?** canlı teşhis: LIVE/OTO kapalı, 0 QUALIFIED, worker döngüsü, kapsam daralması, görsel analiz kesintisi,
  sahte bekleme koşulu (`NONE …`), yavaş analiz, Jev veto oranı.
- **Sinyal hunisi:** evren → hedef → kısa liste → uygun → derin analiz → QUALIFIED → Jev → aday → niyet → emir; ilk sıfır "tıkanma noktası".
- **Görsel Analist:** 9 zaman dilimi kutusu okunmakta olanı yakar; aşama çubuğu (okuma → çekirdek → anlatım → WATCH onarımı).
- **JEV Hakem:** 12 veto sorusu + 9 TF çelişki sorusu; olasılık çubukları ve 0,65 eşik çizgisi.
- **Takip edilen setuplar**, **son 60 dk plan kararları**, **olay akışı**, **yedekler & kaynak sağlığı**.

Gereken: Node.js 18+ (Brain Hub'ın kullandığı Node 22 yeterli). Harici paket yok.
