from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
AGENT = JAVA / 'TradeAgentActivity.java'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANA = JAVA / 'AnalysisPackActivity.java'
BRAIN = JAVA / 'BrainCore.java'
BUILD = APP / 'app/build.gradle'

for p in (AGENT, MAIN, MON, ANA, BRAIN, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.70 missing required file: ' + str(p))

def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    state = 'code'
    esc = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if state == 'line':
            if c == '\n': state = 'code'
            i += 1; continue
        if state == 'block':
            if c == '*' and n == '/': state = 'code'; i += 2; continue
            i += 1; continue
        if state == 'string':
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': state = 'code'
            i += 1; continue
        if state == 'char':
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": state = 'code'
            i += 1; continue
        if c == '/' and n == '/': state = 'line'; i += 2; continue
        if c == '/' and n == '*': state = 'block'; i += 2; continue
        if c == '"': state = 'string'
        elif c == "'": state = 'char'
        elif c == '{': depth += 1
        elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

def replace_method(src, signature, replacement):
    bounds = method_bounds(src, signature)
    if not bounds:
        raise SystemExit('v9.5.70 method missing: ' + signature)
    a, _, e = bounds
    return src[:a] + replacement + src[e:]

agent = AGENT.read_text()
main = MAIN.read_text()
mon = MON.read_text()
ana = ANA.read_text()
brain = BRAIN.read_text()
bf = BUILD.read_text()

if 'V9569_BRAIN_CORE' not in brain or 'V9568_FREE_FIRST_TRADE_AGENT' not in agent:
    raise SystemExit('v9.5.70 prerequisite missing: Brain/Agent')
if 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' not in ana:
    raise SystemExit('v9.5.70 prerequisite missing: same-chat flow')

call_model = r'''    // V9570_9ROUTER_SSE_RESPONSE
    // 9Router/providers may return classic OpenAI JSON or SSE `data:` chunks even
    // when the caller did not explicitly request streaming. Support both.
    private String callModel(String model, String system, JSONArray msgs) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("temperature", 0.18);
        body.put("max_tokens", 1500);
        body.put("stream", false);
        JSONArray all = new JSONArray();
        all.put(new JSONObject().put("role", "system").put("content", system));
        for (int i = 0; i < msgs.length(); i++) all.put(msgs.getJSONObject(i));
        body.put("messages", all);
        String raw = request("POST", baseUrl() + "/chat/completions", body.toString(), true);
        return decodeChatResponse(raw);
    }'''

agent = replace_method(agent, '    private String callModel(String model, String system, JSONArray msgs)', call_model)

if 'private String decodeChatResponse(String raw)' not in agent:
    decoder = r'''
    private String decodeChatResponse(String raw) throws Exception {
        if (raw == null || raw.trim().isEmpty()) throw new Exception("9Router boş yanıt");
        String text = raw.trim();
        if (text.startsWith("{") && text.indexOf("\ndata:") < 0 && !text.startsWith("data:")) {
            try {
                String one = decodeChatObject(new JSONObject(text));
                if (!one.isEmpty()) return one;
            } catch (Throwable ignored) { }
        }
        StringBuilder out = new StringBuilder();
        String[] lines = raw.split("\\r?\\n");
        for (String sourceLine : lines) {
            if (sourceLine == null) continue;
            String line = sourceLine.trim();
            if (line.isEmpty() || line.startsWith(":") || line.startsWith("event:")) continue;
            if (line.startsWith("data:")) line = line.substring(5).trim();
            if (line.isEmpty()) continue;
            if ("[DONE]".equals(line)) break;
            if (!line.startsWith("{")) continue;
            JSONObject obj;
            try { obj = new JSONObject(line); }
            catch (Throwable ignored) { continue; }
            JSONObject err = obj.optJSONObject("error");
            if (err != null) throw new Exception("9Router: " + err.optString("message", err.toString()));
            String part = decodeChatObject(obj);
            if (!part.isEmpty()) out.append(part);
        }
        String result = out.toString().trim();
        if (!result.isEmpty()) return result;

        int pos = 0;
        while (true) {
            int d = raw.indexOf("data:", pos);
            if (d < 0) break;
            int start = raw.indexOf('{', d + 5);
            if (start < 0) break;
            int end = findJsonObjectEnd(raw, start);
            if (end < 0) break;
            try {
                String part = decodeChatObject(new JSONObject(raw.substring(start, end + 1)));
                if (!part.isEmpty()) out.append(part);
            } catch (Throwable ignored) { }
            pos = end + 1;
        }
        result = out.toString().trim();
        if (!result.isEmpty()) return result;
        throw new Exception("9Router yanıtı geldi fakat okunabilir içerik yok");
    }

    private String decodeChatObject(JSONObject o) throws Exception {
        if (o == null) return "";
        JSONObject err = o.optJSONObject("error");
        if (err != null) throw new Exception("9Router: " + err.optString("message", err.toString()));
        JSONArray choices = o.optJSONArray("choices");
        if (choices == null || choices.length() == 0) return "";
        JSONObject choice = choices.optJSONObject(0);
        if (choice == null) return "";
        JSONObject message = choice.optJSONObject("message");
        if (message != null) {
            String t = contentText(message.opt("content"));
            if (!t.isEmpty()) return t;
        }
        JSONObject delta = choice.optJSONObject("delta");
        if (delta != null) {
            String t = contentText(delta.opt("content"));
            if (!t.isEmpty()) return t;
        }
        Object text = choice.opt("text");
        return text == null || text == JSONObject.NULL ? "" : String.valueOf(text);
    }

    private String contentText(Object c) throws Exception {
        if (c == null || c == JSONObject.NULL) return "";
        if (c instanceof String) return (String)c;
        if (c instanceof JSONArray) {
            StringBuilder s = new StringBuilder();
            JSONArray a = (JSONArray)c;
            for (int i = 0; i < a.length(); i++) {
                Object z = a.get(i);
                if (z instanceof JSONObject) {
                    JSONObject jo = (JSONObject)z;
                    String t = jo.optString("text", "");
                    if (t.isEmpty()) t = jo.optString("content", "");
                    s.append(t);
                } else if (z != null && z != JSONObject.NULL) s.append(String.valueOf(z));
            }
            return s.toString();
        }
        return String.valueOf(c);
    }

    private int findJsonObjectEnd(String src, int start) {
        int depth = 0; boolean inString = false; boolean esc = false;
        for (int i = start; i < src.length(); i++) {
            char c = src.charAt(i);
            if (inString) {
                if (esc) esc = false;
                else if (c == '\\') esc = true;
                else if (c == '"') inString = false;
                continue;
            }
            if (c == '"') { inString = true; continue; }
            if (c == '{') depth++;
            else if (c == '}') { depth--; if (depth == 0) return i; }
        }
        return -1;
    }
'''
    anchor = '    private ArrayList<String> discoverFreeModels() throws Exception {'
    if anchor not in agent: raise SystemExit('v9.5.70 decoder anchor missing')
    agent = agent.replace(anchor, decoder + '\n' + anchor, 1)

read_all = r'''    private String readAll(InputStream in) throws Exception {
        if(in==null) return "";
        StringBuilder s=new StringBuilder();
        try(BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){
            String line;
            while((line=r.readLine())!=null) s.append(line).append('\n');
        }
        return s.toString();
    }'''
agent = replace_method(agent, '    private String readAll(InputStream in)', read_all)

agent = agent.replace('c.setConnectTimeout(8000); c.setReadTimeout(45000);', 'c.setConnectTimeout(10000); c.setReadTimeout(90000);')
agent = agent.replace('status.setText("Piyasa verisi + ücretsiz modeller analiz ediliyor…");', 'status.setText("Piyasa verisi hazırlanıyor • ücretsiz model yanıtı bekleniyor…");')

agent = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.70', agent)
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.70', main)
main = re.sub(r'v9\.5(?:\.\d+)+', 'v9.5.70', main)
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.70', mon)
ana = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.70', ana)
ana = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.70', ana)
brain = brain.replace('BRAIN_CORE=v9.5.69', 'BRAIN_CORE=v9.5.70')
brain = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.70', brain)
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091510', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.70'", bf, count=1)

AGENT.write_text(agent); MAIN.write_text(main); MON.write_text(mon); ANA.write_text(ana); BRAIN.write_text(brain); BUILD.write_text(bf)

checks = {
    'sse marker': 'V9570_9ROUTER_SSE_RESPONSE' in AGENT.read_text(),
    'sse data parser': 'line.startsWith("data:")' in AGENT.read_text(),
    'delta content': 'choice.optJSONObject("delta")' in AGENT.read_text(),
    'done support': '"[DONE]".equals(line)' in AGENT.read_text(),
    'normal json retained': 'choice.optJSONObject("message")' in AGENT.read_text(),
    'line preservation': "s.append(line).append('\\n')" in AGENT.read_text(),
    'visible timeout': 'c.setReadTimeout(90000);' in AGENT.read_text(),
    'brain retained': 'V9569_BRAIN_CORE' in BRAIN.read_text(),
    'same chat retained': 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' in ANA.read_text(),
    'plan only retained': 'V9564_PLAN_CODE_ONLY_CONTRACT' in ANA.read_text(),
    'version': "versionName '9.5.70'" in BUILD.read_text() and 'versionCode 26091510' in BUILD.read_text(),
}
for name, ok in checks.items(): print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad: raise SystemExit('v9.5.70 sanity failed: ' + ', '.join(bad))

print('v9.5.70 OK: 9Router classic JSON + SSE data-chunk parsing, delta.content assembly, [DONE], 90s visible timeout; Brain/Leader/same-chat flows retained.')
