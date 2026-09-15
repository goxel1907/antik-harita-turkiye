from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
ANA = APP / 'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java'
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not ANA.exists() or not MAIN.exists():
    raise SystemExit('v9.5.65b required source missing')

a = ANA.read_text()
main = MAIN.read_text()
checks = {
    'v9565 external route': 'V9565_EXTERNAL_SAME_CHAT_BROWSER' in a,
    'single same-chat route': 'v9565OpenSavedChat(payload, false);' in a,
    'batch same-chat route': 'v9565OpenSavedChat(v9545CombinedPrompt, true);' in a,
    'saved route storage': 'v9565_chat_route' in a and 'current_chat_url' in a,
    'plan-only contract': 'V9564_PLAN_CODE_ONLY_CONTRACT' in a and 'V9564_BATCH_FINAL_OUTPUT' in a,
    'batch selector 2-8': 'if (unique.size() >= 8) break;' in a and 'selected.size() < 2 || selected.size() > 8' in main,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.65b compatibility failed: ' + ', '.join(bad))

PATCH_9567 = Path(__file__).with_name('v9567_prompt_clipboard_gallery_samechat.py')
if not PATCH_9567.exists():
    raise SystemExit('v9.5.67 patch missing: ' + str(PATCH_9567))
exec(compile(PATCH_9567.read_text(), str(PATCH_9567), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9567)})

PATCH_9568 = Path(__file__).with_name('v9568_free_trade_agent.py')
if not PATCH_9568.exists():
    raise SystemExit('v9.5.68 patch missing: ' + str(PATCH_9568))
exec(compile(PATCH_9568.read_text(), str(PATCH_9568), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9568)})

PATCH_9568B = Path(__file__).with_name('v9568b_release_identity_compat.py')
if not PATCH_9568B.exists():
    raise SystemExit('v9.5.68b patch missing: ' + str(PATCH_9568B))
exec(compile(PATCH_9568B.read_text(), str(PATCH_9568B), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9568B)})
