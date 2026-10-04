# R2544.34 model settings verification — 2026-10-04

The 9Router management API was accessed through its installed vendor CLI client on loopback. Chrome control still reports `Codex auth token is unavailable`; no Chrome session, login token, API authentication policy, or Tailscale route was replaced.

## Applied 9Router settings

- Existing `grafik` and `claude-my-combo` names and IDs were preserved.
- Both model chains now contain `kr/claude-haiku-4.5` followed by `kr/claude-sonnet-4.5`.
- Both per-combo strategies are `fallback`. The previous `fusion` strategy returned HTTP 200 but rejected the simple readback request during its synthesis step. With fallback, both combos returned the exact requested text.
- Vision capacity uses these same two models, with round robin disabled. Both direct models identified a generated red image correctly. This verifies image connectivity, not chart-analysis expertise.
- Login and API-key requirements, RTK, Headroom and network routes were preserved.

Final combo probes at 10:37 UTC: `grafik` HTTP 200 / exact readback / 1795 ms; `claude-my-combo` HTTP 200 / exact readback / 1091 ms. Old OpenCode Muse routes returned HTTP 200 with empty content and were excluded from these chains; they are not marked healthy.

## OpenRouter free evidence preferences

Configuration supports ordered preferences only within the current verified free catalog:

1. `apodex/apodex-1.1-mini:free`
2. `qwen/qwen3.8-27b:free`
3. `nvidia/nemotron-3.5-lightning:free`

Only Apodex was verified by a real readback request in this change. The other two are catalog candidates, not validated specialists. The live zero-price catalog, provider maximum price of zero, per-model cooldowns, health ranking, quota enforcement and two-attempt limit remain authoritative. Preferences cannot restore a removed model or enable paid fallback. Evidence remains optional and cannot block or overrule JEV.

The preference block was saved in `C:\JEV-Brain\runtime\config\models.json`, with the original backed up. **The running core remains R2544.33 and does not read these new preferences.** Source worker verification used the saved configuration and its separate probe state: Apodex returned the exact text, HTTP success, free-only routing and schema validation in 2825 ms. This is not a deployment or a trade.

## Validation and remaining boundaries

- Full source suite: 680 passed, zero failed; `full-tests-model-settings.log`.
- Tests cover absent/paid preferred-model rejection and fallback while a preferred route is cooling down.
- Fresh core GET checks: R2544.33, LIVE false, leader AUTO false.
- Runtime R34 installation still requires the established Windows administrator deployment. The prior automatic approval rejection was not retried or circumvented.
- Chrome connector authorization and phone APK installation remain unverified. No LIVE/OTO arming, financial order, credential replacement, or APK build occurred.

Local evidence: `C:\JEV-Brain\logs\CODEX-20261004-R34` (`model-settings-verification.json`, `router-settings-after.json`, `combo-strategies-after.json`, `router-vision-probe.json`, `model-runtime-status.json`). Before-change backups: `C:\JEV-Brain\BrainHubBackups\CODEX-MODEL-SETTINGS-20261004-1331`.
