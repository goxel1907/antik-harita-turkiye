# C:\JEV-Brain — BrainHub / JEV sistem klasörü

29.09.2026'dan itibaren sistemin yeni evi burası (R2544.12). Eski `C:\BrainHub` silinmedi; geri dönüş için yerinde durur.

## Klasörler
| Klasör | İçerik |
|---|---|
| `runtime\` | Çalışan sistem: `server\` (core 8787), `office-dashboard\` (Office 8790), `config\` (şifreli anahtarlar DPAPI), `data\` (sqlite günlük), `logs\`, `docs\` |
| `source\` | Kaynak kod (git, dal `r2544-claude-panel-guard`). Claude değişiklikleri burada yapar |
| `BrainHubBackups\` | `manage.ps1` her güncellemede otomatik yedek alır |
| `docs\raporlar\` | Claude raporları ve devir notları (PDF) |
| `_yedekler\` | Deploy edilmemiş sürüm yedekleri (zip) |
| `logs\` | Geçiş / deploy / geri dönüş kayıtları |

## Betikler (sağ tık → Yönetici olarak çalıştır)
| Dosya | Ne zaman |
|---|---|
| `JEV-BRAIN-GECIS.cmd` | **Bir kez**, açık pozisyon yokken: eski sistemi durdurur, veriyi kopyalar, yeni sürümü `runtime`'a kurar ve başlatır |
| `JEV-GERI-DON.cmd` | Sorun olursa: yeni sistemi durdurur, güncel veriyle eski `C:\BrainHub`'ı başlatır |
| `JEV-DEPLOY.cmd` | Geçişten sonraki her güncelleme (beklenen sürüm `BEKLENEN-SURUM.txt`) |
| `JEV-BASLAT.cmd` | PC yeniden açılınca core + Office |
| `JEV-DURUM.cmd` | Sağlık testi |
| `JEV-OFFICE.cmd` | Office ekranı |

Kurallar: LIVE ve OTO kullanıcıya aittir; hiçbir betik bunları açmaz. Core yeniden başlayınca LIVE ARM kapanır, uygulamadan yeniden açılır. Telefon emir yürütücüsü değildir (PC-only).
