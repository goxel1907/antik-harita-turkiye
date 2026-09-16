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

PATCH_9569 = Path(__file__).with_name('v9569_brain_core_leader_handoff.py')
if not PATCH_9569.exists():
    raise SystemExit('v9.5.69 patch missing: ' + str(PATCH_9569))
exec(compile(PATCH_9569.read_text(), str(PATCH_9569), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9569)})

PATCH_9570 = Path(__file__).with_name('v9570_9router_sse_stream_fix.py')
if not PATCH_9570.exists():
    raise SystemExit('v9.5.70 patch missing: ' + str(PATCH_9570))
exec(compile(PATCH_9570.read_text(), str(PATCH_9570), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9570)})

PATCH_9570B = Path(__file__).with_name('v9570b_9router_sse_compile_safe.py')
if not PATCH_9570B.exists():
    raise SystemExit('v9.5.70b patch missing: ' + str(PATCH_9570B))
exec(compile(PATCH_9570B.read_text(), str(PATCH_9570B), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9570B)})

PATCH_9570C = Path(__file__).with_name('v9570c_release_identity_compat.py')
if not PATCH_9570C.exists():
    raise SystemExit('v9.5.70c patch missing: ' + str(PATCH_9570C))
exec(compile(PATCH_9570C.read_text(), str(PATCH_9570C), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9570C)})

PATCH_9571 = Path(__file__).with_name('v9571_opencode_free_provider_guard.py')
if not PATCH_9571.exists():
    raise SystemExit('v9.5.71 patch missing: ' + str(PATCH_9571))
exec(compile(PATCH_9571.read_text(), str(PATCH_9571), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9571)})

PATCH_9571B = Path(__file__).with_name('v9571b_release_identity_compat.py')
if not PATCH_9571B.exists():
    raise SystemExit('v9.5.71b patch missing: ' + str(PATCH_9571B))
exec(compile(PATCH_9571B.read_text(), str(PATCH_9571B), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9571B)})

PATCH_9572 = Path(__file__).with_name('v9572_9router_response_shape_guard.py')
if not PATCH_9572.exists():
    raise SystemExit('v9.5.72 patch missing: ' + str(PATCH_9572))
exec(compile(PATCH_9572.read_text(), str(PATCH_9572), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9572)})

PATCH_9573 = Path(__file__).with_name('v9573_opencode_stream_mode.py')
if not PATCH_9573.exists():
    raise SystemExit('v9.5.73 patch missing: ' + str(PATCH_9573))
exec(compile(PATCH_9573.read_text(), str(PATCH_9573), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9573)})

PATCH_9574 = Path(__file__).with_name('v9574_opencode_default_request_retry.py')
if not PATCH_9574.exists():
    raise SystemExit('v9.5.74 patch missing: ' + str(PATCH_9574))
exec(compile(PATCH_9574.read_text(), str(PATCH_9574), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9574)})

PATCH_9575 = Path(__file__).with_name('v9575_multi_free_learning_memory.py')
if not PATCH_9575.exists():
    raise SystemExit('v9.5.75 patch missing: ' + str(PATCH_9575))
exec(compile(PATCH_9575.read_text(), str(PATCH_9575), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9575)})

PATCH_9576 = Path(__file__).with_name('v9576_live_auto_execution.py')
if not PATCH_9576.exists():
    raise SystemExit('v9.5.76 patch missing: ' + str(PATCH_9576))
exec(compile(PATCH_9576.read_text(), str(PATCH_9576), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9576)})

PATCH_9576B = Path(__file__).with_name('v9576b_compile_safe.py')
if not PATCH_9576B.exists():
    raise SystemExit('v9.5.76b patch missing: ' + str(PATCH_9576B))
exec(compile(PATCH_9576B.read_text(), str(PATCH_9576B), 'exec'), {'__name__': '__main__', '__file__': str(PATCH_9576B)})
