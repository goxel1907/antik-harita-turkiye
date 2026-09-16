from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
AGENT = APP / 'app/src/main/java/com/futuresalarm/app/TradeAgentActivity.java'
if not AGENT.exists():
    raise SystemExit('v9.5.72 agent missing')

src = AGENT.read_text()
if 'V9570_9ROUTER_SSE_RESPONSE' not in src:
    raise SystemExit('v9.5.72 requires SSE decoder')
if 'V9571_OPENCODE_FREE_PROVIDER_GUARD' not in src:
    raise SystemExit('v9.5.72 requires OpenCode provider guard')


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
    if not p: raise SystemExit('v9.5.72 method missing: ' + sig)
    return text[:p[0]] + replacement + text[p[1]:]

new_decode_obj = r'''    // V9572_9ROUTER_RESPONSE_SHAPE_GUARD
    private String decodeChatObject(JSONObject o) throws Exception {
        if (o == null) return "";
        JSONObject err = o.optJSONObject("error");
        if (err != null) throw new Exception("9Router: " + err.optString("message", err.toString()));

        String top = firstNonEmpty(
                contentText(o.opt("output_text")),
                contentText(o.opt("content")),
                contentText(o.opt("text")),
                contentText(o.opt("response")));
        if (!top.isEmpty()) return top;

        JSONArray choices = o.optJSONArray("choices");
        if (choices == null || choices.length() == 0) return "";
        JSONObject choice = choices.optJSONObject(0);
        if (choice == null) return "";

        JSONObject message = choice.optJSONObject("message");
        if (message != null) {
            String t = firstNonEmpty(
                    contentText(message.opt("content")),
                    contentText(message.opt("reasoning_content")),
                    contentText(message.opt("reasoning")),
                    contentText(message.opt("text")));
            if (!t.isEmpty()) return t;
        }

        JSONObject delta = choice.optJSONObject("delta");
        if (delta != null) {
            String t = firstNonEmpty(
                    contentText(delta.opt("content")),
                    contentText(delta.opt("reasoning_content")),
                    contentText(delta.opt("reasoning")),
                    contentText(delta.opt("text")));
            if (!t.isEmpty()) return t;
        }

        String direct = firstNonEmpty(
                contentText(choice.opt("text")),
                contentText(choice.opt("content")),
                contentText(choice.opt("reasoning_content")),
                contentText(choice.opt("reasoning")));
        return direct;
    }

    private String firstNonEmpty(String... xs) {
        if (xs == null) return "";
        for (String x : xs) if (x != null && !x.trim().isEmpty()) return x;
        return "";
    }'''
src = replace_method(src, '    private String decodeChatObject(JSONObject o)', new_decode_obj)

new_content = r'''    private String contentText(Object c) throws Exception {
        if (c == null || c == JSONObject.NULL) return "";
        if (c instanceof String) return (String)c;
        if (c instanceof JSONObject) {
            JSONObject jo = (JSONObject)c;
            return firstNonEmpty(
                    contentText(jo.opt("text")),
                    contentText(jo.opt("content")),
                    contentText(jo.opt("value")),
                    contentText(jo.opt("output_text")));
        }
        if (c instanceof JSONArray) {
            StringBuilder s = new StringBuilder();
            JSONArray a = (JSONArray)c;
            for (int i = 0; i < a.length(); i++) {
                String t = contentText(a.opt(i));
                if (t != null && !t.isEmpty()) s.append(t);
            }
            return s.toString();
        }
        return String.valueOf(c);
    }'''
src = replace_method(src, '    private String contentText(Object c)', new_content)

old = 'throw new Exception("9Router yanıtı geldi fakat okunabilir içerik yok");'
new = 'throw new Exception("9Router yanıtı geldi fakat okunabilir içerik yok • RAW=" + clip(raw.replace("\\n"," ").replace("\\r"," "), 420));'
if old not in src:
    raise SystemExit('v9.5.72 unreadable-response anchor missing')
src = src.replace(old, new, 1)

AGENT.write_text(src)

check = AGENT.read_text()
required = [
    'V9572_9ROUTER_RESPONSE_SHAPE_GUARD',
    'reasoning_content',
    'output_text',
    'private String firstNonEmpty',
    'RAW=',
    'V9571_OPENCODE_FREE_PROVIDER_GUARD',
    'V9570_9ROUTER_SSE_RESPONSE',
]
missing = [x for x in required if x not in check]
if missing:
    raise SystemExit('v9.5.72 sanity missing: ' + ', '.join(missing))
print('v9.5.72 OK: 9Router response-shape guard handles content/text/output_text/reasoning_content/reasoning in JSON + SSE and exposes a clipped RAW diagnostic when no text can be decoded.')
