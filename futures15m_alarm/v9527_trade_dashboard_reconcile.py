from pathlib import Path
import subprocess
import urllib.request

# v9.5.27 recovery wrapper.
# The previously re-packed base64 payload was corrupted (Incorrect padding).
# Always execute the known-good, immutable v9.5.27 patch from its original commit.
GOOD_COMMIT = "2169eca7109b26d21391b803503edce6481ba4d2"
REL_PATH = "futures15m_alarm/v9527_trade_dashboard_reconcile.py"
REPO = Path(__file__).resolve().parents[1]
RAW_URL = (
    "https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/"
    + GOOD_COMMIT + "/" + REL_PATH
)


def load_known_good():
    # Prefer the already-cloned Git object so normal builds have no extra network dependency.
    try:
        data = subprocess.check_output(
            ["git", "-C", str(REPO), "show", GOOD_COMMIT + ":" + REL_PATH],
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        if data.startswith(b"import base64,zlib") and b"b64decode" in data:
            return data
    except Exception:
        pass

    # Codemagic/GitHub shallow clones may not contain the historical object. The commit is
    # immutable, so fetch exactly that pinned revision as a controlled fallback.
    req = urllib.request.Request(RAW_URL, headers={"User-Agent": "Futures15mAlarm-build"})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = r.read()
    if not data.startswith(b"import base64,zlib") or b"b64decode" not in data:
        raise SystemExit("v9.5.27 recovery failed: known-good patch validation failed")
    return data


payload = load_known_good()
print("v9.5.27 recovery OK: executing immutable known-good dashboard/reconcile patch")
exec(compile(payload.decode("utf-8"), GOOD_COMMIT + ":" + REL_PATH, "exec"), {
    "__file__": str(Path(__file__)),
    "__name__": "__main__",
})
