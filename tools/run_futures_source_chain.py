"""Run the exact Codemagic source preparation list for CI compile validation."""
from pathlib import Path
import os
import re
import subprocess
import sys

repo = Path(os.environ.get('CM_BUILD_DIR', Path(__file__).resolve().parents[1])).resolve()
yaml = (repo / 'codemagic.yaml').read_text(encoding='utf-8')
stage = yaml.split('- name: Prepare Futures Alarm', 1)[1].split('- name: Set Android SDK', 1)[0]
commands = []
for line in stage.splitlines():
    line = line.strip()
    match = re.fullmatch(r'(python3|bash) "\$CM_BUILD_DIR/([\w/.-]+)"', line)
    if match:
        commands.append([match.group(1), str(repo / match.group(2))])
if not commands or not any('prepare_v9523.sh' in c[1] for c in commands) or not any('v9577_brainhub_dry_run.py' in c[1] for c in commands):
    raise SystemExit('Codemagic source chain incomplete')
for command in commands:
    print('RUN', Path(command[1]).name, flush=True)
    subprocess.run(command, cwd=repo, env={**os.environ, 'CM_BUILD_DIR': str(repo)}, check=True)
print('SOURCE_CHAIN_OK')
