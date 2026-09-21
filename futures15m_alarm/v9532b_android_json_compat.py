from pathlib import Path
import binascii
import struct
import zlib

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
CTX = APP / 'app/src/main/java/com/futuresalarm/app/V9531DecisionContext.java'

if not CTX.exists():
    raise SystemExit('v9.5.32b missing V9531DecisionContext.java')

s = CTX.read_text()

old_array = '            return new org.json.JSONArray(res.body().string());'
new_array = '''            String payload = res.body().string();
            try {
                return new org.json.JSONArray(payload);
            } catch (org.json.JSONException jsonError) {
                throw new java.io.IOException("Invalid Binance JSON array", jsonError);
            }'''

old_object = '            return new org.json.JSONObject(res.body().string());'
new_object = '''            String payload = res.body().string();
            try {
                return new org.json.JSONObject(payload);
            } catch (org.json.JSONException jsonError) {
                throw new java.io.IOException("Invalid Binance JSON object", jsonError);
            }'''

if old_array in s:
    s = s.replace(old_array, new_array, 1)
elif 'Invalid Binance JSON array' not in s:
    raise SystemExit('v9.5.32b JSONArray anchor missing')

if old_object in s:
    s = s.replace(old_object, new_object, 1)
elif 'Invalid Binance JSON object' not in s:
    raise SystemExit('v9.5.32b JSONObject anchor missing')

if 'V9532B_ANDROID_JSON_CHECKED_EXCEPTION_FIX' not in s:
    marker = 'final class V9531DecisionContext {'
    s = s.replace(marker, marker + '\n    // V9532B_ANDROID_JSON_CHECKED_EXCEPTION_FIX', 1)

CTX.write_text(s)

final = CTX.read_text()
checks = {
    'array parse wrapped': 'Invalid Binance JSON array' in final and 'catch (org.json.JSONException jsonError)' in final,
    'object parse wrapped': 'Invalid Binance JSON object' in final,
    'raw checked parse removed': 'return new org.json.JSONArray(res.body().string());' not in final and 'return new org.json.JSONObject(res.body().string());' not in final,
    'marker': 'V9532B_ANDROID_JSON_CHECKED_EXCEPTION_FIX' in final,
}
failed = [k for k,v in checks.items() if not v]
for k,v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
if failed:
    raise SystemExit('v9.5.32b sanity failed: ' + ', '.join(failed))

# V9532B_AAPT2_INDEXED_PNG_CANONICALIZE
# Codemagic macOS/ARM AAPT2 34/36 can SIGBUS on the legacy indexed launcher PNG.
# Preserve the exact pixels, but rewrite this one resource as a plain non-interlaced RGBA PNG
# using only Python stdlib so the build does not depend on Pillow/ImageMagick/sips.
ICON = APP / 'app/src/main/res/drawable-nodpi/ic_launcher_pro.png'


def _paeth(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', binascii.crc32(kind + payload) & 0xffffffff)


def _canonicalize_indexed_png(path):
    data = path.read_bytes()
    sig = b'\x89PNG\r\n\x1a\n'
    if not data.startswith(sig):
        raise SystemExit('v9.5.32b launcher icon is not a PNG')

    pos = len(sig)
    ihdr = None
    palette = None
    alpha = None
    idat = []
    while pos + 12 <= len(data):
        n = struct.unpack('>I', data[pos:pos+4])[0]
        kind = data[pos+4:pos+8]
        payload = data[pos+8:pos+8+n]
        if pos + 12 + n > len(data):
            raise SystemExit('v9.5.32b launcher PNG has a truncated chunk')
        crc_expected = struct.unpack('>I', data[pos+8+n:pos+12+n])[0]
        crc_actual = binascii.crc32(kind + payload) & 0xffffffff
        if crc_actual != crc_expected:
            raise SystemExit('v9.5.32b launcher PNG CRC mismatch in ' + kind.decode('ascii', 'replace'))
        if kind == b'IHDR':
            ihdr = payload
        elif kind == b'PLTE':
            palette = payload
        elif kind == b'tRNS':
            alpha = payload
        elif kind == b'IDAT':
            idat.append(payload)
        elif kind == b'IEND':
            break
        pos += 12 + n

    if ihdr is None or len(ihdr) != 13:
        raise SystemExit('v9.5.32b launcher PNG missing/invalid IHDR')
    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack('>IIBBBBB', ihdr)
    if (bit_depth, color_type, compression, filter_method, interlace) != (8, 3, 0, 0, 0):
        print('Launcher PNG already canonical/non-legacy:', width, height, 'bit', bit_depth, 'type', color_type, 'interlace', interlace)
        return False
    if palette is None or len(palette) % 3 != 0 or not idat:
        raise SystemExit('v9.5.32b indexed launcher PNG missing palette/IDAT')

    raw = zlib.decompress(b''.join(idat))
    stride = width
    expected = height * (stride + 1)
    if len(raw) != expected:
        raise SystemExit('v9.5.32b launcher PNG scanline size mismatch')

    rows = []
    prev = bytearray(stride)
    off = 0
    for y in range(height):
        f = raw[off]
        src = raw[off+1:off+1+stride]
        off += stride + 1
        cur = bytearray(stride)
        for x, val in enumerate(src):
            left = cur[x-1] if x else 0
            up = prev[x]
            up_left = prev[x-1] if x else 0
            if f == 0:
                out = val
            elif f == 1:
                out = (val + left) & 255
            elif f == 2:
                out = (val + up) & 255
            elif f == 3:
                out = (val + ((left + up) >> 1)) & 255
            elif f == 4:
                out = (val + _paeth(left, up, up_left)) & 255
            else:
                raise SystemExit('v9.5.32b launcher PNG uses unsupported filter ' + str(f))
            cur[x] = out
        rows.append(cur)
        prev = cur

    palette_entries = len(palette) // 3
    rgba_scan = bytearray()
    for row in rows:
        rgba_scan.append(0)  # deterministic filter: None
        for idx in row:
            if idx >= palette_entries:
                raise SystemExit('v9.5.32b launcher PNG palette index out of range')
            base = idx * 3
            rgba_scan.extend((
                palette[base],
                palette[base + 1],
                palette[base + 2],
                alpha[idx] if alpha is not None and idx < len(alpha) else 255,
            ))

    new_ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    out = sig + _chunk(b'IHDR', new_ihdr) + _chunk(b'IDAT', zlib.compress(bytes(rgba_scan), 9)) + _chunk(b'IEND', b'')
    before = len(data)
    path.write_bytes(out)
    print('Canonicalized launcher PNG indexed->RGBA:', width, 'x', height, 'bytes', before, '->', len(out))
    return True


if not ICON.exists():
    raise SystemExit('v9.5.32b launcher icon missing before AAPT2 compatibility pass')
_canonicalize_indexed_png(ICON)

icon_bytes = ICON.read_bytes()
if not icon_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('v9.5.32b canonical launcher PNG signature check failed')
if len(icon_bytes) < 33:
    raise SystemExit('v9.5.32b canonical launcher PNG too small')
new_ihdr = icon_bytes[16:29]
w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', new_ihdr)
if (w, h, bd, ct, comp, filt, inter) != (256, 256, 8, 6, 0, 0, 0):
    raise SystemExit('v9.5.32b canonical launcher PNG format check failed: ' + str((w, h, bd, ct, comp, filt, inter)))
print('OK   launcher PNG canonical RGBA for AAPT2: 256x256, RGBA8, non-interlaced')
print('v9.5.32b OK: Android org.json checked exceptions wrapped + AAPT2-safe launcher PNG.')
