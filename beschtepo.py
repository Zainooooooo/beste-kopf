""" Backup Manager - FastAPI Backend + Backup Engine."""
from __future__ import annotations
import json, os, shutil, socket, threading, time, platform
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    HAS_SCHED = True
except ImportError:
    HAS_SCHED = False

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
CONFIG_FILE = DATA / "config.json"
HISTORY_FILE = DATA / "history.json"

DEFAULT_CONFIG = {
    "sources": [],
    "target": "",
    "schedule_cron": "0 2 * * *",
    "retention_days": 30,
    "encrypt": False,
}

# ---------- State ----------
_lock = threading.Lock()
_current_job: Optional[dict] = None
_boot_time = time.time()

def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

def get_config() -> dict:
    cfg = load_json(CONFIG_FILE, DEFAULT_CONFIG.copy())
    for k, v in DEFAULT_CONFIG.items():
        cfg.setdefault(k, v)
    return cfg

def get_history() -> list:
    return load_json(HISTORY_FILE, [])

def append_history(entry: dict):
    h = get_history()
    h.insert(0, entry)
    save_json(HISTORY_FILE, h[:100])

# ---------- Backup Engine ----------
def disk_info(path: str) -> Optional[dict]:
    try:
        u = shutil.disk_usage(path)
        return {
            "total_gb": round(u.total / 1e9, 1),
            "used_gb": round(u.used / 1e9, 1),
            "free_gb": round(u.free / 1e9, 1),
            "percent": round(u.used / u.total * 100, 1) if u.total else 0,
        }
    except Exception:
        return None

def folder_size(path: Path) -> int:
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file(): total += p.stat().st_size
        except Exception:
            pass
    return total

def run_backup(manual: bool = True):
    global _current_job, _abort_requested
    cfg = get_config()

    with _lock:
        if _current_job and _current_job.get("status") == "running":
            return
        _abort_requested = False
        _current_job = {
            "status": "running", "manual": manual, "progress": 0,
            "started": datetime.now().isoformat(timespec="seconds"),
            "log": [], "size_mb": 0,
        }

    def log(msg):
        _current_job["log"].append(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
        if len(_current_job["log"]) > 200:
            _current_job["log"] = _current_job["log"][-200:]

    try:
        if not cfg["sources"]:
            raise RuntimeError("Keine Quellen konfiguriert.")
        if not cfg["target"]:
            raise RuntimeError("Kein Ziel konfiguriert.")
        target = Path(cfg["target"])
        if not target.exists():
            raise RuntimeError(f"Ziel '{target}' nicht erreichbar (HDD nicht verbunden?).")

        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        snapshot = target / f"backup_{ts}"
        snapshot.mkdir(parents=True, exist_ok=True)
        log(f"Snapshot: {snapshot}")

        total_bytes = 0
        valid = [s for s in cfg["sources"] if Path(s).exists()]
        if not valid:
            raise RuntimeError("Keine gültigen Quellen gefunden.")

        for i, src in enumerate(valid):
            if _abort_requested:
                raise RuntimeError("Backup abgebrochen")
            sp = Path(src)
            log(f"Sichere: {sp}")
            dest = snapshot / sp.name
            try:
                shutil.copytree(sp, dest, dirs_exist_ok=True, symlinks=False,
                                ignore_dangling_symlinks=True)
                size = folder_size(dest)
                total_bytes += size
                log(f"  → {round(size/1e6,1)} MB kopiert")
            except Exception as e:
                log(f"  ! Fehler: {e}")
            if _abort_requested:
                raise RuntimeError("Backup abgebrochen")
            _current_job["progress"] = int((i + 1) / len(valid) * 100)
            _current_job["size_mb"] = round(total_bytes / 1e6, 1)

        # Retention
        cleanup_old_snapshots(target, cfg["retention_days"], log)

        finished = datetime.now().isoformat(timespec="seconds")
        entry = {
            "status": "success", "manual": manual,
            "started": _current_job["started"], "finished": finished,
            "size_mb": round(total_bytes / 1e6, 1),
            "snapshot": str(snapshot),
        }
        append_history(entry)
        _current_job.update(entry)
        _current_job["status"] = "success"
        _current_job["progress"] = 100
        log("Backup erfolgreich abgeschlossen.")

    except Exception as e:
        finished = datetime.now().isoformat(timespec="seconds")
        entry = {
            "status": "error", "manual": manual,
            "started": _current_job["started"], "finished": finished,
            "error": str(e),
        }
        append_history(entry)
        _current_job.update(entry)
        _current_job["status"] = "error"
        log(f"FEHLER: {e}")

def cleanup_old_snapshots(target: Path, days: int, log):
    if days <= 0: return
    cutoff = time.time() - days * 86400
    removed = 0
    for d in target.glob("backup_*"):
        if d.is_dir() and d.stat().st_mtime < cutoff:
            try:
                shutil.rmtree(d); removed += 1
            except Exception as e:
                log(f"  Konnte alten Snapshot nicht löschen: {e}")
    if removed:
        log(f"Retention: {removed} alte Snapshots gelöscht (>{days}d)")

# ---------- Scheduler ----------
_scheduler = None
_abort_requested = False

def setup_scheduler():
    global _scheduler
    if not HAS_SCHED: return
    cfg = get_config()
    if _scheduler:
        _scheduler.shutdown(wait=False)
    _scheduler = BackgroundScheduler()
    cron = cfg.get("schedule_cron", "").strip()
    if cron:
        try:
            parts = cron.split()
            if len(parts) == 5:
                trigger = CronTrigger(
                    minute=parts[0], hour=parts[1], day=parts[2],
                    month=parts[3], day_of_week=parts[4],
                )
                _scheduler.add_job(lambda: threading.Thread(
                    target=run_backup, args=(False,), daemon=True).start(),
                    trigger=trigger, id="auto_backup")
                _scheduler.start()
        except Exception as e:
            print(f"Scheduler-Fehler: {e}")

# ---------- API Models ----------
class ConfigModel(BaseModel):
    sources: list[str] = Field(default_factory=list)
    target: str = ""
    schedule_cron: str = "0 2 * * *"
    retention_days: int = 30
    encrypt: bool = False

# ---------- App ----------
app = FastAPI(title="venta Backup Manager")
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")

@app.on_event("startup")
def _startup():
    setup_scheduler()

@app.get("/", response_class=HTMLResponse)
def index():
    html_path = ROOT / "templates" / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))

def get_mounted_drives() -> list[dict]:
    drives = []
    # System-Verzeichnisse und Dateisysteme, die zu filtern sind
    skip_mountpoints = ('/', '/boot', '/efi', '/var', '/tmp', '/home', '/sys', '/proc', '/dev', '/run')
    skip_filesystems = ('vfat', 'tmpfs', 'ramfs', 'squashfs', 'isofs')
    
    if HAS_PSUTIL:
        for p in psutil.disk_partitions(all=False):
            if not p.device.startswith(('/dev/', 'C:')):
                continue
            if any(skip in p.device for skip in ('loop', 'ram', 'sr', 'fd')):
                continue
            if any(skip in p.mountpoint for skip in skip_mountpoints):
                continue
            if p.fstype in skip_filesystems:
                continue
            drives.append({
                'device': p.device,
                'mountpoint': p.mountpoint,
                'fstype': p.fstype,
                'opts': p.opts,
            })
    elif platform.system() == 'Linux':
        try:
            with open('/proc/mounts', encoding='utf-8') as f:
                for line in f:
                    parts = line.split()
                    if len(parts) < 3:
                        continue
                    device, mountpoint, fstype = parts[:3]
                    if not device.startswith('/dev/'):
                        continue
                    if any(skip in device for skip in ('loop', 'ram', 'sr', 'fd')):
                        continue
                    if any(skip in mountpoint for skip in skip_mountpoints):
                        continue
                    if fstype in skip_filesystems:
                        continue
                    drives.append({
                        'device': device,
                        'mountpoint': mountpoint,
                        'fstype': fstype,
                        'opts': parts[3] if len(parts) > 3 else '',
                    })
        except Exception:
            pass
    return drives

@app.get("/api/drives")
def api_drives():
    return {"drives": get_mounted_drives()}

@app.get("/api/status")
def api_status():
    cfg = get_config()
    target_ok = bool(cfg["target"]) and Path(cfg["target"]).exists()
    info = disk_info(cfg["target"]) if target_ok else None
    hist = get_history()
    last = hist[0] if hist else None
    return {
        "host": socket.gethostname(),
        "platform": platform.system(),
        "uptime_h": round((time.time() - _boot_time) / 3600, 1),
        "target_path": cfg["target"],
        "target_connected": target_ok,
        "target_info": info,
        "config": cfg,
        "current": _current_job,
        "abort_requested": _abort_requested,
        "last_backup": last,
        "scheduler_active": _scheduler.running if _scheduler else False,
    }

@app.get("/api/config")
def api_get_config():
    return get_config()

@app.post("/api/config")
def api_set_config(cfg: ConfigModel):
    save_json(CONFIG_FILE, cfg.model_dump())
    setup_scheduler()
    return {"ok": True}

@app.post("/api/backup/start")
def api_start():
    with _lock:
        if _current_job and _current_job.get("status") == "running":
            raise HTTPException(409, "Backup läuft bereits.")
    threading.Thread(target=run_backup, args=(True,), daemon=True).start()
    return {"ok": True}

@app.post("/api/backup/abort")
def api_abort():
    global _abort_requested
    if not _current_job or _current_job.get("status") != "running":
        raise HTTPException(400, "Kein laufendes Backup zum Abbrechen.")
    _abort_requested = True
    return {"ok": True}

@app.get("/api/history")
def api_history():
    return get_history()

@app.get("/api/browse")
def api_browse(path: str = ""):
    try:
        if not path:
            # Roots
            if platform.system() == "Windows":
                import string
                drives = [f"{d}:\\" for d in string.ascii_uppercase
                          if Path(f"{d}:\\").exists()]
                return {"path": "", "entries": [
                    {"name": d, "path": d, "is_dir": True} for d in drives]}
            else:
                p = Path("/")
        else:
            p = Path(path)
        if not p.exists() or not p.is_dir():
            raise HTTPException(404, "Pfad nicht gefunden")
        entries = []
        for child in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            try:
                entries.append({
                    "name": child.name,
                    "path": str(child),
                    "is_dir": child.is_dir(),
                })
            except PermissionError:
                continue
        return {"path": str(p), "entries": entries[:200]}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(500, str(e))
