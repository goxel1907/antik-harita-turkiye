from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
AGENT = APP / 'app/src/main/java/com/futuresalarm/app/TradeAgentActivity.java'
if not AGENT.exists():
    raise SystemExit('v9.5.74 agent missing')

src = AGENT.read_text()
for marker in ('V9570_9ROUTER_SSE_RESPONSE','V9571_OPENCODE_FREE_PROVIDER_GUARD','V9572_9ROUTER_RESPONSE_SHAPE_GUARD','V9573_OPENCODE_STREAM_MODE'):
    if marker not in src:
        raise SystemExit('v9.5.74 prerequisite missing: ' + marker)


def bounds(text, sig):
    a = text.find(sig)
    if a < 0: return None
    b = text.find('{', a)
    if b < 0: return None
    depth = 1; i = b + 1; state = 'code'; esc = False
    while i < len(text) and depth:
        c = text[i]; n = text[i+1] if i+1 < len(text) else ''
        if state == 'line':
            if c == '\n': state = 'code'
        elif state == 'block':
            if c == '*' and n == '/': state = 'code'; i += 1
        elif state == 'str':
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': state = 'code'
        elif state == 'chr':
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": state = 'code'
        else:
            if c == '/' and n == '/': state = 'line'; i += 1
            elif c == '/' and n == '*': state = 'block'; i += 1
            elif c == '"': state = 'str'
            elif c == "'": state = 'chr'
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, i)


def replace_method(text, sig, replacement):
    p = bounds(text, sig)
    if not p: raise SystemExit('v9.5.74 method missing: ' + sig)
    return text[:p[0]] + replacement + text[p[1]:]

# Align Android request with the exact curl shape that already proved working:
# model + messages only. 9Router/OpenCode decides whether to return JSON or SSE.
# Do NOT send stream/temperature/max_tokens here; v0.5.75 produced empty OUT=0
# for the explicit stream=true app request, while the default curl returned text.
call_model = r'''    // V9574_OPENCODE_DEFAULT_REQUEST_RETRY
    private String callModel(String model, String system, JSONArray msgs) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model);
        JSONArray all = new JSONArray();
        all.put(new JSONObject().put("role", "system").put("content", system));
        for (int i = 0; i < msgs.length(); i++) all.put(msgs.getJSONObject(i));
        body.put("messages", all);

        String raw = request("POST", baseUrl() + "/chat/completions", body.toString(), true);
        try {
            return decodeChatResponse(raw);
        } catch (Exception first) {
            // One controlled retry with a shorter system wrapper. This is only for
            // the provider returning a syntactically valid but text-empty response.
            String m = first.getMessage() == null ? "" : first.getMessage();
            if (!m.contains("okunabilir içerik yok")) throw first;

            JSONObject retry = new JSONObject();
            retry.put("model", model);
            JSONArray simple = new JSONArray();
            simple.put(new JSONObject().put("role", "system").put("content",
                    "Türkçe yanıt ver. Verilmeyen veriyi uydurma. Soruyu doğrudan yanıtla."));
            for (int i = 0; i < msgs.length(); i++) simple.put(msgs.getJSONObject(i));
            retry.put("messages", simple);
            String raw2 = request("POST", baseUrl() + "/chat/completions", retry.toString(), true);
            return decodeChatResponse(raw2);
        }
    }'''
src = replace_method(src, '    private String callModel(String model, String system, JSONArray msgs)', call_model)

# Never force JSON/SSE at the HTTP header layer; accept whatever 9Router emits.
old_accept = 'c.setRequestProperty("Accept", body != null && body.contains("\\\"stream\\\":true") ? "text/event-stream, application/json" : "application/json");'
if old_accept in src:
    src = src.replace(old_accept, 'c.setRequestProperty("Accept","*/*");', 1)
elif 'c.setRequestProperty("Accept","application/json");' in src:
    src = src.replace('c.setRequestProperty("Accept","application/json");', 'c.setRequestProperty("Accept","*/*");', 1)
else:
    raise SystemExit('v9.5.74 Accept anchor missing')

AGENT.write_text(src)

check = AGENT.read_text()
required = [
    'V9574_OPENCODE_DEFAULT_REQUEST_RETRY',
    'body.put("model", model);',
    'body.put("messages", all);',
    'c.setRequestProperty("Accept","*/*");',
    'decodeChatResponse(raw)',
    'decodeChatResponse(raw2)',
    'V9572_9ROUTER_RESPONSE_SHAPE_GUARD',
    'V9571_OPENCODE_FREE_PROVIDER_GUARD',
]
missing = [x for x in required if x not in check]
if missing:
    raise SystemExit('v9.5.74 sanity missing: ' + ', '.join(missing))

# Ensure the final callModel no longer contains the knobs that caused OUT=0.
p = bounds(check, '    private String callModel(String model, String system, JSONArray msgs)')
method = check[p[0]:p[1]] if p else ''
for banned in ('body.put("stream"', 'body.put("temperature"', 'body.put("max_tokens"'):
    if banned in method:
        raise SystemExit('v9.5.74 banned request knob remains: ' + banned)

print('v9.5.74 OK: OpenCode request now matches known-good curl shape (model+messages only), accepts JSON/SSE, and retries once with a shorter system wrapper only on empty-content responses. Release identity unchanged.')
