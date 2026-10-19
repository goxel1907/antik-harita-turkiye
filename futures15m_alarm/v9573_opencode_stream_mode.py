from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
AGENT = APP / 'app/src/main/java/com/futuresalarm/app/TradeAgentActivity.java'
if not AGENT.exists():
    raise SystemExit('v9.5.73 agent missing')

src = AGENT.read_text()
for marker in ('V9570_9ROUTER_SSE_RESPONSE','V9571_OPENCODE_FREE_PROVIDER_GUARD','V9572_9ROUTER_RESPONSE_SHAPE_GUARD'):
    if marker not in src:
        raise SystemExit('v9.5.73 prerequisite missing: ' + marker)

# OpenCode Free via 9Router v0.5.75 can return an empty assistant message when
# stream=false, while the same request produces the actual answer as SSE
# delta.content chunks. We already have an SSE decoder; request streaming on purpose.
old = 'body.put("stream", false);'
new = 'body.put("stream", true); // V9573_OPENCODE_STREAM_MODE'
if old not in src:
    raise SystemExit('v9.5.73 stream=false anchor missing')
src = src.replace(old, new, 1)

# Advertise both SSE and JSON because 9Router/provider behavior may vary.
old_accept = 'c.setRequestProperty("Accept","application/json");'
new_accept = 'c.setRequestProperty("Accept", body != null && body.contains("\\\"stream\\\":true") ? "text/event-stream, application/json" : "application/json");'
if old_accept not in src:
    raise SystemExit('v9.5.73 Accept anchor missing')
src = src.replace(old_accept, new_accept, 1)

AGENT.write_text(src)

check = AGENT.read_text()
required = [
    'V9573_OPENCODE_STREAM_MODE',
    'body.put("stream", true)',
    'text/event-stream, application/json',
    'V9572_9ROUTER_RESPONSE_SHAPE_GUARD',
    'line.startsWith("data:")',
    'choice.optJSONObject("delta")',
]
missing = [x for x in required if x not in check]
if missing:
    raise SystemExit('v9.5.73 sanity missing: ' + ', '.join(missing))

print('v9.5.73 OK: OpenCode Free requests stream=true through 9Router; existing SSE delta parser is retained; JSON remains accepted. Release identity unchanged.')
