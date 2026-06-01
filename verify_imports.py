import importlib
import sys

modules = [
    'fastapi', 'pydantic', 'apscheduler', 'psutil',
    'jinja2', 'uvicorn', 'aiofiles'
]

missing = []
for m in modules:
    try:
        importlib.import_module(m)
        print(f"{m}: OK")
    except Exception as e:
        print(f"{m}: MISSING ({e})")
        missing.append(m)

if missing:
    print('\nEinige Pakete fehlen: ' + ', '.join(missing))
    sys.exit(1)
else:
    print('\nAlle Pakete erfolgreich importiert.')
    sys.exit(0)
