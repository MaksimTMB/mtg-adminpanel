"""
MTG Agent v2.1 — полный менеджер ноды.
Кэширует метрики в памяти, обновляет в фоне каждые 5 сек.
Все endpoints отвечают мгновенно (< 10мс) — данные из кэша.
"""
import os, re, secrets, subprocess, asyncio, shutil
from pathlib import Path
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import docker

app = FastAPI(title="MTG Agent", version="2.1.0")

AGENT_TOKEN  = os.environ.get("AGENT_TOKEN", "mtg-agent-secret")
BASE_DIR     = Path("/opt/mtg/users")
MTG_IMAGE    = "nineseconds/mtg:2"
MTG_PORT     = 3128
START_PORT   = int(os.environ.get("START_PORT", "4433"))
MTG_PORT_HEX = "0C38"   # 3128 in hex
CACHE_TTL    = 10        # seconds before cache considered stale

try:
    dclient = docker.from_env()
except Exception:
    dclient = None

# ── In-memory metrics cache ───────────────────────────────
_cache: dict = {"containers": [], "updated_at": None}
_cache_lock = asyncio.Lock()
_cache_ready = asyncio.Event()


def auth(token: str):
    if token != AGENT_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Docker low-level helpers ──────────────────────────────
def _get_mtg_containers():
    """Return list of mtg-* containers via SDK, or None if SDK unavailable/failed."""
    if not dclient:
        return None
    try:
        return [c for c in dclient.containers.list(all=True)
                if c.name.startswith("mtg-") and c.name != "mtg-agent"]
    except Exception:
        return None  # SDK failed — caller must use CLI fallback


def _container_running_cli(name: str) -> bool:
    """CLI fallback: check if container is running (used when Docker SDK unavailable)."""
    try:
        r = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}", name],
            capture_output=True, text=True)
        return r.returncode == 0 and r.stdout.strip() == "true"
    except Exception:
        return False


def _connections(container) -> int:
    try:
        container.reload()
        pid = container.attrs.get("State", {}).get("Pid", 0)
        if not pid:
            return 0
        # Read both tcp and tcp6 — MTG binds IPv4 (appears in tcp only),
        # but some kernels/configs use dual-stack (appears in tcp6 as IPv4-mapped).
        lines = []
        for fname in ("tcp", "tcp6"):
            try:
                lines += open(f"/proc/{pid}/net/{fname}").readlines()[1:]
            except Exception:
                pass
        ips = set()
        for line in lines:
            parts = line.split()
            if len(parts) < 4:
                continue
            local_port = parts[1].split(":")[1] if ":" in parts[1] else ""
            if parts[3] == "01" and local_port == MTG_PORT_HEX:
                ips.add(parts[2].rsplit(":", 1)[0])
        return len(ips)
    except Exception:
        return 0


def _traffic(container) -> dict:
    try:
        stats = container.stats(stream=False)
        nets  = stats.get("networks", {})
        rx = sum(v.get("rx_bytes", 0) for v in nets.values())
        tx = sum(v.get("tx_bytes", 0) for v in nets.values())

        def fmt(b):
            if b >= 1_073_741_824: return f"{b/1_073_741_824:.2f}GB"
            if b >= 1_048_576:     return f"{b/1_048_576:.2f}MB"
            if b >= 1024:          return f"{b/1024:.2f}KB"
            return f"{b}B"

        return {"rx": fmt(rx), "tx": fmt(tx), "rx_bytes": rx, "tx_bytes": tx}
    except Exception:
        return {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}


def _read_config(user_dir: Path) -> dict:
    secret = port = None
    cfg = user_dir / "config.toml"
    dc  = user_dir / "docker-compose.yml"
    if cfg.exists():
        m = re.search(r'secret\s*=\s*"([^"]+)"', cfg.read_text())
        if m: secret = m.group(1)
    if dc.exists():
        m = re.search(r"(\d+):3128", dc.read_text())
        if m: port = int(m.group(1))
    return {"secret": secret, "port": port}


# ── Core metrics compute (called in background) ───────────
def _compute_all() -> list:
    """Compute full metrics for all containers. Slow (Docker stats). Run in background."""
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    containers = _get_mtg_containers()   # None means SDK failed → use CLI fallback
    sdk_ok = containers is not None
    by_name = {c.name: c for c in (containers or [])}
    result = []

    for user_dir in sorted(BASE_DIR.iterdir()):
        if not user_dir.is_dir():
            continue
        name     = user_dir.name
        cfg      = _read_config(user_dir)
        c        = by_name.get(f"mtg-{name}")
        if c is not None:
            running = c.status == "running"
        elif sdk_ok:
            running = False  # SDK works, container genuinely not found → stopped
        else:
            running = _container_running_cli(f"mtg-{name}")  # SDK failed → CLI fallback
        devices  = _connections(c) if (running and c is not None) else 0
        traffic  = _traffic(c)     if (running and c is not None) else {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}
        result.append({
            "name":        name,
            "port":        cfg["port"],
            "secret":      cfg["secret"],
            "running":     running,
            "status":      c.status if c else "stopped",
            "connections": devices,
            "is_online":   devices > 0,
            "traffic":     traffic,
        })
    return result


async def _refresh_loop():
    """Background task: refresh metrics cache every 5 seconds."""
    while True:
        try:
            data = await asyncio.get_event_loop().run_in_executor(None, _compute_all)
            async with _cache_lock:
                _cache["containers"] = data
                _cache["updated_at"] = datetime.now().isoformat()
            _cache_ready.set()
        except Exception as e:
            print(f"[cache] refresh error: {e}")
            _cache_ready.set()   # unblock waiting requests even on error
        await asyncio.sleep(5)


@app.on_event("startup")
async def startup():
    # Start refresh loop — first iteration runs immediately (no initial sleep).
    # Do NOT await here: that would block the ASGI lifespan and prevent the agent
    # from accepting requests until _compute_all() finishes (can be 30+ seconds).
    asyncio.create_task(_refresh_loop())


def _cached_containers():
    return _cache.get("containers", [])


# ── Filesystem helpers ────────────────────────────────────
def _generate_secret() -> str:
    return f"ee{secrets.token_hex(16)}{'google.com'.encode().hex()}"


def _next_port() -> int:
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    max_port = START_PORT - 1
    for d in BASE_DIR.iterdir():
        if not d.is_dir(): continue
        dc = d / "docker-compose.yml"
        if dc.exists():
            m = re.search(r"(\d+):3128", dc.read_text())
            if m: max_port = max(max_port, int(m.group(1)))
    return max_port + 1


def _write_files(user_dir: Path, name: str, port: int, secret: str):
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "config.toml").write_text(
        f'secret = "{secret}"\nbind-to = "0.0.0.0:{MTG_PORT}"\n'
    )
    (user_dir / "docker-compose.yml").write_text(
        f"services:\n"
        f"  mtg-{name}:\n"
        f"    image: {MTG_IMAGE}\n"
        f"    container_name: mtg-{name}\n"
        f"    restart: unless-stopped\n"
        f"    ports:\n"
        f'      - "{port}:{MTG_PORT}"\n'
        f"    volumes:\n"
        f"      - {user_dir}/config.toml:/config.toml:ro\n"
        f"    command: run /config.toml\n"
    )


def _dc(user_dir: Path, *args):
    subprocess.run(["docker", "compose"] + list(args),
                   cwd=str(user_dir), check=False, capture_output=True)


# ── Endpoints ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.1.0"}


@app.get("/metrics")
async def metrics(x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    # Return immediately — never block. Empty list on cold start, cached data otherwise.
    containers = _cached_containers()
    return JSONResponse({
        "containers": [
            {
                "name":        u["name"],
                "running":     u["running"],
                "status":      u["status"],
                "connections": u["connections"],
                "devices":     u["connections"],
                "is_online":   u["is_online"],
                "traffic":     u["traffic"],
            }
            for u in containers
        ],
        "total": len(containers),
        "cached_at": _cache.get("updated_at"),
    })


@app.get("/users")
async def list_users(x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    # Return immediately — never block. Empty list on cold start, cached data otherwise.
    return JSONResponse(_cached_containers())


class CreateUserBody(BaseModel):
    name: str


@app.post("/users")
async def create_user(body: CreateUserBody, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    name = body.name
    if not re.match(r'^[a-zA-Z0-9_-]{1,32}$', name):
        raise HTTPException(status_code=400, detail="Invalid name")
    user_dir = BASE_DIR / name
    if user_dir.exists():
        raise HTTPException(status_code=409, detail="User already exists")
    port   = _next_port()
    secret = _generate_secret()
    _write_files(user_dir, name, port, secret)
    _dc(user_dir, "up", "-d")
    # Invalidate cache so next read sees the new user
    _cache_ready.clear()
    asyncio.create_task(_refresh_once())
    return JSONResponse({"name": name, "port": port, "secret": secret, "status": "running"})


@app.delete("/users/{name}")
async def delete_user(name: str, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    _dc(user_dir, "down")
    shutil.rmtree(str(user_dir), ignore_errors=True)
    asyncio.create_task(_refresh_once())
    return JSONResponse({"ok": True})


def _cache_set_status(name: str, running: bool):
    """Immediately patch running status in cache without waiting for full refresh."""
    containers = list(_cache.get("containers", []))
    for item in containers:
        if item["name"] == name:
            item["running"] = running
            item["status"] = "running" if running else "stopped"
            if not running:
                item["connections"] = 0
                item["is_online"] = False
            break
    _cache["containers"] = containers


@app.post("/users/{name}/start")
async def start_user(name: str, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    if dclient:
        try:
            c = dclient.containers.get(f"mtg-{name}")
            if c.status != "running":
                c.start()
            _cache_set_status(name, True)
            asyncio.create_task(_refresh_once())
            return JSONResponse({"ok": True})
        except docker.errors.NotFound:
            pass  # container missing — fall through to compose up -d
        except Exception:
            pass  # SDK error — fall through to CLI fallback
    # CLI fallback: compose up -d recreates container if needed
    r = subprocess.run(["docker", "compose", "up", "-d"],
                       cwd=str(user_dir), capture_output=True)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=r.stderr.decode())
    _cache_set_status(name, True)
    asyncio.create_task(_refresh_once())
    return JSONResponse({"ok": True})


@app.post("/users/{name}/stop")
async def stop_user(name: str, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    if dclient:
        try:
            c = dclient.containers.get(f"mtg-{name}")
            if c.status == "running":
                c.stop(timeout=5)
            _cache_set_status(name, False)
            asyncio.create_task(_refresh_once())
            return JSONResponse({"ok": True})
        except docker.errors.NotFound:
            pass
        except Exception:
            pass  # SDK error — fall through to CLI
    r = subprocess.run(["docker", "compose", "stop"],
                       cwd=str(user_dir), capture_output=True)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=r.stderr.decode())
    _cache_set_status(name, False)
    asyncio.create_task(_refresh_once())
    return JSONResponse({"ok": True})


@app.post("/users/{name}/restart")
async def restart_user(name: str, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    if dclient:
        try:
            c = dclient.containers.get(f"mtg-{name}")
            c.restart(timeout=5)
            _cache_set_status(name, True)
            asyncio.create_task(_refresh_once())
            return JSONResponse({"ok": True})
        except docker.errors.NotFound:
            pass
        except Exception:
            pass  # SDK error — fall through to CLI
    subprocess.run(["docker", "compose", "stop"], cwd=str(user_dir), capture_output=True)
    r = subprocess.run(["docker", "compose", "up", "-d"],
                       cwd=str(user_dir), capture_output=True)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=r.stderr.decode())
    _cache_set_status(name, True)
    asyncio.create_task(_refresh_once())
    return JSONResponse({"ok": True})


@app.get("/version")
def mtg_version(x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    try:
        r = subprocess.run(["docker", "inspect", MTG_IMAGE, "--format", "{{.Created}}"],
                           capture_output=True, text=True)
        return JSONResponse({"image": MTG_IMAGE, "created": r.stdout.strip()})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pull")
async def pull_mtg(x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    try:
        r = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(["docker", "pull", MTG_IMAGE],
                                   capture_output=True, text=True, timeout=120)
        )
        return JSONResponse({"ok": True, "output": r.stdout[-800:]})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _refresh_once():
    """Trigger a single immediate cache refresh (after mutations)."""
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, _compute_all)
        async with _cache_lock:
            _cache["containers"] = data
            _cache["updated_at"] = datetime.now().isoformat()
        _cache_ready.set()
    except Exception as e:
        print(f"[cache] refresh_once error: {e}")
