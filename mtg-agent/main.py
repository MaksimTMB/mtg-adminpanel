"""
MTG Agent v2.0 — полный менеджер ноды.
Управляет MTProto-прокси через Docker без SSH.
MTG image и базовая директория захардкожены.
Порт: 8081
"""
import os, re, secrets, subprocess
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import docker

app = FastAPI(title="MTG Agent", version="2.0.0")

AGENT_TOKEN  = os.environ.get("AGENT_TOKEN", "mtg-agent-secret")
BASE_DIR     = Path("/opt/mtg/users")
MTG_IMAGE    = "nineseconds/mtg:2"
MTG_PORT     = 3128        # MTG internal port (fixed)
START_PORT   = int(os.environ.get("START_PORT", "4433"))
MTG_PORT_HEX = "0C38"     # 3128 in hex

try:
    dclient = docker.from_env()
except Exception:
    dclient = None


# ── Auth helper ───────────────────────────────────────────
def auth(token: str):
    if token != AGENT_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Docker helpers ────────────────────────────────────────
def get_container(name: str):
    try:
        return dclient.containers.get(f"mtg-{name}")
    except Exception:
        return None


def get_mtg_containers():
    try:
        return [c for c in dclient.containers.list(all=True)
                if c.name.startswith("mtg-") and c.name != "mtg-agent"]
    except Exception:
        return []


def get_connections(container) -> int:
    try:
        container.reload()
        pid = container.attrs.get("State", {}).get("Pid", 0)
        if not pid:
            return 0
        tcp6_path = f"/proc/{pid}/net/tcp6"
        try:
            with open(tcp6_path) as f:
                lines = f.readlines()[1:]
        except Exception:
            tcp_path = f"/proc/{pid}/net/tcp"
            with open(tcp_path) as f:
                lines = f.readlines()[1:]
        remote_ips = set()
        for line in lines:
            parts = line.split()
            if len(parts) < 4:
                continue
            state = parts[3]
            local_addr = parts[1]
            remote_addr = parts[2]
            local_port = local_addr.split(":")[1] if ":" in local_addr else ""
            if state == "01" and local_port == MTG_PORT_HEX:
                remote_ip = remote_addr.rsplit(":", 1)[0] if ":" in remote_addr else remote_addr
                remote_ips.add(remote_ip)
        return len(remote_ips)
    except Exception:
        return 0


def get_traffic(container) -> dict:
    try:
        stats = container.stats(stream=False)
        nets = stats.get("networks", {})
        total_rx = sum(v.get("rx_bytes", 0) for v in nets.values())
        total_tx = sum(v.get("tx_bytes", 0) for v in nets.values())

        def fmt(b: int) -> str:
            if b >= 1_073_741_824: return f"{b / 1_073_741_824:.2f}GB"
            if b >= 1_048_576:     return f"{b / 1_048_576:.2f}MB"
            if b >= 1024:          return f"{b / 1024:.2f}KB"
            return f"{b}B"

        return {"rx": fmt(total_rx), "tx": fmt(total_tx), "rx_bytes": total_rx, "tx_bytes": total_tx}
    except Exception:
        return {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}


# ── User filesystem helpers ───────────────────────────────
def generate_secret() -> str:
    rand = secrets.token_hex(16)
    google_hex = "google.com".encode().hex()
    return f"ee{rand}{google_hex}"


def get_next_port() -> int:
    max_port = START_PORT - 1
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    for user_dir in BASE_DIR.iterdir():
        if not user_dir.is_dir():
            continue
        dc_file = user_dir / "docker-compose.yml"
        if dc_file.exists():
            content = dc_file.read_text()
            m = re.search(r"(\d+):3128", content)
            if m:
                max_port = max(max_port, int(m.group(1)))
    return max_port + 1


def read_user_config(user_dir: Path) -> dict:
    """Read port and secret from user directory files."""
    secret, port = None, None
    config_file = user_dir / "config.toml"
    dc_file     = user_dir / "docker-compose.yml"
    if config_file.exists():
        content = config_file.read_text()
        m = re.search(r'secret\s*=\s*"([^"]+)"', content)
        if m:
            secret = m.group(1)
    if dc_file.exists():
        content = dc_file.read_text()
        m = re.search(r"(\d+):3128", content)
        if m:
            port = int(m.group(1))
    return {"secret": secret, "port": port}


def write_user_files(user_dir: Path, name: str, port: int, secret: str):
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "config.toml").write_text(
        f'secret = "{secret}"\nbind-to = "0.0.0.0:{MTG_PORT}"\n'
    )
    (user_dir / "docker-compose.yml").write_text(
        f"""services:
  mtg-{name}:
    image: {MTG_IMAGE}
    container_name: mtg-{name}
    restart: unless-stopped
    ports:
      - "{port}:{MTG_PORT}"
    volumes:
      - {user_dir}/config.toml:/config.toml:ro
    command: run /config.toml
"""
    )


def dc_up(user_dir: Path):
    subprocess.run(
        ["docker", "compose", "up", "-d"],
        cwd=str(user_dir), check=True,
        capture_output=True
    )


def dc_stop(user_dir: Path):
    subprocess.run(
        ["docker", "compose", "stop"],
        cwd=str(user_dir), check=False,
        capture_output=True
    )


def dc_start(user_dir: Path):
    subprocess.run(
        ["docker", "compose", "start"],
        cwd=str(user_dir), check=False,
        capture_output=True
    )


def dc_down(user_dir: Path):
    subprocess.run(
        ["docker", "compose", "down"],
        cwd=str(user_dir), check=False,
        capture_output=True
    )


# ── Endpoints ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/metrics")
def metrics(x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    containers = get_mtg_containers()
    result = []
    for c in containers:
        name    = c.name
        running = c.status == "running"
        devices = get_connections(c) if running else 0
        traffic = get_traffic(c) if running else {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}
        result.append({
            "name": name,
            "running": running,
            "status": c.status,
            "connections": devices,
            "devices": devices,
            "is_online": devices > 0,
            "traffic": traffic,
        })
    return JSONResponse({"containers": result, "total": len(result)})


@app.get("/users")
def list_users(x_agent_token: str = Header(default="")):
    """List all users: reads config files + docker state."""
    auth(x_agent_token)
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for user_dir in sorted(BASE_DIR.iterdir()):
        if not user_dir.is_dir():
            continue
        name = user_dir.name
        cfg  = read_user_config(user_dir)
        c    = get_container(name)
        running  = c is not None and c.status == "running"
        devices  = get_connections(c) if running and c else 0
        traffic  = get_traffic(c)     if running and c else {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}
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
    return JSONResponse(result)


class CreateUserBody(BaseModel):
    name: str


@app.post("/users")
def create_user(body: CreateUserBody, x_agent_token: str = Header(default="")):
    """Create a new MTG proxy user."""
    auth(x_agent_token)
    name = body.name
    if not re.match(r'^[a-zA-Z0-9_-]{1,32}$', name):
        raise HTTPException(status_code=400, detail="Invalid name")
    user_dir = BASE_DIR / name
    if user_dir.exists():
        raise HTTPException(status_code=409, detail="User already exists")
    port   = get_next_port()
    secret = generate_secret()
    write_user_files(user_dir, name, port, secret)
    try:
        dc_up(user_dir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Docker error: {e}")
    return JSONResponse({"name": name, "port": port, "secret": secret, "status": "running"})


@app.delete("/users/{name}")
def delete_user(name: str, x_agent_token: str = Header(default="")):
    """Stop and remove a user."""
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    dc_down(user_dir)
    import shutil
    shutil.rmtree(str(user_dir), ignore_errors=True)
    return JSONResponse({"ok": True})


@app.post("/users/{name}/start")
def start_user(name: str, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    dc_start(user_dir)
    return JSONResponse({"ok": True})


@app.post("/users/{name}/stop")
def stop_user(name: str, x_agent_token: str = Header(default="")):
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    dc_stop(user_dir)
    return JSONResponse({"ok": True})


@app.post("/users/{name}/restart")
def restart_user(name: str, x_agent_token: str = Header(default="")):
    """Restart container (resets MTG traffic counter)."""
    auth(x_agent_token)
    user_dir = BASE_DIR / name
    if not user_dir.exists():
        raise HTTPException(status_code=404, detail="User not found")
    dc_stop(user_dir)
    dc_start(user_dir)
    return JSONResponse({"ok": True})


@app.get("/version")
def mtg_version(x_agent_token: str = Header(default="")):
    """Get MTG Docker image version info."""
    auth(x_agent_token)
    try:
        result = subprocess.run(
            ["docker", "inspect", MTG_IMAGE, "--format", "{{.Created}}"],
            capture_output=True, text=True
        )
        created = result.stdout.strip()
        return JSONResponse({"image": MTG_IMAGE, "created": created})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pull")
def pull_mtg(x_agent_token: str = Header(default="")):
    """Pull latest MTG image."""
    auth(x_agent_token)
    try:
        result = subprocess.run(
            ["docker", "pull", MTG_IMAGE],
            capture_output=True, text=True, timeout=120
        )
        return JSONResponse({"ok": True, "output": result.stdout[-800:]})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
