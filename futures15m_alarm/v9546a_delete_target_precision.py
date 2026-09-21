from pathlib import Path

MAIN = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/MainActivity.java')
if not MAIN.exists():
    raise SystemExit('v9.5.46a MainActivity missing')


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0: return None
    b = src.find('{', a)
    if b < 0: return None
    depth = 1; i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]; n = src[i+1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/': block_comment = False; i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/': line_comment = True; i += 1
            elif c == '/' and n == '*': block_comment = True; i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

s = MAIN.read_text()
if 'V9546_ANALYSIS_DELETE_SHORTCUT' not in s:
    raise SystemExit('v9.5.46a delete shortcut prerequisite missing')

b = method_bounds(s, '    private android.view.View v9546FindPlanCard(String symbol)')
if not b:
    raise SystemExit('v9.5.46a v9546FindPlanCard missing')
a, _, e = b
new_method = r'''    // V9546A_PRECISE_DELETE_TARGET
    private android.view.View v9546FindPlanCard(String symbol) {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null || symbol == null) return null;
        int start = 0;
        for (int i = 0; i < root.getChildCount(); i++) {
            String t = v9544FlatText(root.getChildAt(i));
            if (t.contains("İZLENEN PLANLAR") || t.contains("IZLENEN PLANLAR")) {
                start = i;
                break;
            }
        }

        for (int i = start; i < root.getChildCount(); i++) {
            android.view.View branch = root.getChildAt(i);
            android.view.View coinText = v9544FindCoinTarget(branch, symbol);
            if (coinText == null) continue;

            // Climb from the exact symbol label to the nearest ancestor that
            // owns a delete control. This prevents a large section container
            // with several coin cards from resolving to another coin's button.
            android.view.View cur = coinText;
            for (int depth = 0; depth < 10 && cur != null; depth++) {
                if (cur instanceof android.view.ViewGroup) {
                    android.view.View del = v9546FindDeleteControl(cur);
                    if (del != null) return cur;
                }
                android.view.ViewParent parent = cur.getParent();
                if (!(parent instanceof android.view.View)) break;
                cur = (android.view.View) parent;
                if (cur == root) break;
            }

            // If the exact card has no detectable delete control in this UI
            // revision, return the smallest branch containing the symbol; the
            // caller will safely fall back to scrolling instead of deleting.
            return branch;
        }
        return null;
    }'''
s = s[:a] + new_method + s[e:]
MAIN.write_text(s)
out = MAIN.read_text()
if 'V9546A_PRECISE_DELETE_TARGET' not in out or 'v9544FindCoinTarget(branch, symbol)' not in out:
    raise SystemExit('v9.5.46a precision target injection failed')
print('v9.5.46a OK: delete shortcut resolves the exact symbol card before reusing its existing delete action.')
