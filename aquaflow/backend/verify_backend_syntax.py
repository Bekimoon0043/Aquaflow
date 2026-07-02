from pathlib import Path
import py_compile
import sys

ROOT = Path(__file__).resolve().parent
TARGETS = [
    ROOT / 'main.py',
    ROOT / 'app_state.py',
    ROOT / 'api' / 'routes',
    ROOT / 'engine',
    ROOT / 'audio',
    ROOT / 'ai',
    ROOT / 'plc',
    ROOT / 'scheduler',
]

files = []
for target in TARGETS:
    if target.is_file() and target.suffix == '.py':
        files.append(target)
    elif target.is_dir():
        files.extend(sorted(target.rglob('*.py')))

seen = set()
unique_files = []
for file in files:
    key = str(file.resolve())
    if key not in seen:
        seen.add(key)
        unique_files.append(file)

for file in unique_files:
    try:
        py_compile.compile(str(file), doraise=True)
    except Exception as exc:
        print(f'FAILED: {file.relative_to(ROOT)}')
        print(exc)
        sys.exit(1)

print(f'Backend syntax OK: {len(unique_files)} files checked')
