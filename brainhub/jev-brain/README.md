# C:\JEV-Brain — BrainHub / JEV sistem klasörü (TEK YER)

29.09.2026'dan itibaren BrainHub'ın **bütün** parçaları burada: çalışan sistem, PC kaynak kodu, APK kaynak kodu, yedekler, raporlar ve betikler. Eski yerler silinmedi; yalnız arşiv. Onlarda **çalışılmaz**.

## Klasörler
| Klasör | İçerik | Git |
|---|---|---|
| `runtime\` | Çalışan sistem: `server\` (core 8787), `office-dashboard\` (Office 8790), `config\` (DPAPI şifreli anahtarlar), `data\` (sqlite günlük), `logs\`, `docs\`. Geçişte oluşur | — |
| `source\` | PC kaynak kodu (`brainhub\` + Android kopyası). Claude değişiklikleri **burada** yapar | Bağımsız klon, dal `r2544-claude-panel-guard`, origin = GitHub |
| `apk-source\` | APK kaynağı (Codemagic bu daldan derler) | Bağımsız klon, dal `futures15m-alarm-public-build`, origin = GitHub |
| `BrainHubBackups\` | `manage.ps1` her güncellemede otomatik tam yedek | — |
| `docs\raporlar\` | Bütün Claude raporları ve devir notları (PDF) | — |
| `_yedekler\` | Deploy edilmemiş sürüm yedekleri (zip) | — |
| `logs\` | Geçiş / deploy / geri dönüş kayıtları | — |

## Eski yer → yeni yer
| Eski (arşiv, kullanılmaz) | Yeni |
|---|---|
| `C:\BrainHub\server`, `config`, `data`, `logs`, `office-dashboard` | `C:\JEV-Brain\runtime\...` |
| `C:\BrainHub\_work_r2543_obs_20260928-211718` (geliştirme kopyası) | `C:\JEV-Brain\source` |
| `C:\Users\adm\Documents\Codex\2026-09-26\...\work\repo` (Codex ana repo) | `C:\JEV-Brain\source` (tüm geçmiş dahil; ana repo'ya dokunulmadı) |
| `C:\Users\adm\Documents\Codex\2026-09-28\...\work\public-release` (APK) | `C:\JEV-Brain\apk-source` |
| `C:\BrainHubBackups` | `C:\JEV-Brain\BrainHubBackups` |
| `C:\BrainHub\*.pdf` raporlar | `C:\JEV-Brain\docs\raporlar` |
| `C:\BrainHub\R2544-DEPLOY.cmd`, `R2544-APK-PUSH.cmd` | `JEV-DEPLOY.cmd`, `APK-PUSH.cmd` (eskileri artık çalışmaz, yönlendirir) |

## Betikler (sağ tık → Yönetici olarak çalıştır)
| Dosya | Ne zaman |
|---|---|
| `JEV-BRAIN-GECIS.cmd` | **Bir kez**, açık pozisyon yokken: eski sistemi durdurur, veriyi kopyalar, yeni sürümü `runtime`'a kurar ve başlatır |
| `JEV-GERI-DON.cmd` | Sorun olursa: yeni sistemi durdurur, güncel veriyle eski `C:\BrainHub`'ı başlatır |
| `JEV-DEPLOY.cmd` | Geçişten sonraki her PC güncellemesi (beklenen commit `BEKLENEN-SURUM.txt`) |
| `APK-PUSH.cmd` | Yeni APK derlemesi: `apk-source` dalını GitHub'a gönderir, Codemagic yeni build başlatır (beklenen commit `BEKLENEN-PUBLIC.txt`) |
| `JEV-BASLAT.cmd` / `JEV-DURUM.cmd` / `JEV-OFFICE.cmd` | Başlat / sağlık testi / Office ekranı |
| `LIVE-KAPAT.cmd` | Acil durum: LIVE yetkisini kaldırır (açık pozisyona ve borsadaki stop/TP emirlerine dokunmaz) |

## Hata yapmamak için kurallar
1. Kod yalnız `source\` (PC) ve `apk-source\` (APK) içinde değişir. Eski klasörlerde commit/deploy yapılmaz.
2. Her deploy'dan önce `BEKLENEN-SURUM.txt` / `BEKLENEN-PUBLIC.txt` güncellenir; betik başka commit'i kurmaz.
3. Git klasörlerinde kalan `*.lock` dosyası git'i kilitler. Claude'un Linux kabuğu dosya silemediği için kilitler `.git\_claude_to_delete_*` klasörüne taşınır; o klasörler güvenle silinebilir.
4. LIVE ve OTO kullanıcıya aittir; hiçbir betik açmaz. Core yeniden başlayınca LIVE ARM kapanır, uygulamadan yeniden açılır.
5. Telefon emir yürütücüsü değildir (PC-only, fail-closed). R2544.29 APK sabit https://8z9rvd.tail8c30c4.ts.net adresine bağlanır. Tailscale Serve yalnız tailnet içinde HTTPS 443 üzerinden PC'deki 127.0.0.1:8787 core servisine yönlenir; Funnel kapalıdır. 9Router 20128 mobil API hedefi değildir.
6. Claude oturumlarında bağlanacak klasör: yalnız `C:\JEV-Brain`.
