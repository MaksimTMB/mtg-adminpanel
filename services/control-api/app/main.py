import io
import json
import os
import shlex
import socket
import sqlite3
import urllib.error
import urllib.request
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import paramiko
import pyotp
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_VERSION = "0.3.0-mtg-test"
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "changeme")
AGENT_TOKEN = os.getenv("AGENT_TOKEN", "mtg-agent-secret")
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "mtg-panel.db"
PUBLIC_DIR = Path(os.getenv("PUBLIC_DIR", "/app/public"))

DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def add_column_if_missing(conn: sqlite3.Connection, table: str, col_sql: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_sql}")
    except sqlite3.OperationalError:
        pass


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS nodes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              host TEXT NOT NULL,
              domain TEXT,
              ssh_user TEXT DEFAULT 'root',
              ssh_port INTEGER DEFAULT 22,
              ssh_key TEXT,
              ssh_password TEXT,
              base_dir TEXT DEFAULT '/opt/mtg/users',
              start_port INTEGER DEFAULT 4433,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              flag TEXT DEFAULT NULL,
              agent_port INTEGER DEFAULT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              node_id INTEGER NOT NULL,
              name TEXT NOT NULL,
              port INTEGER NOT NULL,
              secret TEXT NOT NULL,
              status TEXT DEFAULT 'active',
              note TEXT DEFAULT '',
              expires_at DATETIME DEFAULT NULL,
              traffic_limit_gb REAL DEFAULT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              max_devices INTEGER DEFAULT NULL,
              traffic_reset_interval TEXT DEFAULT NULL,
              next_reset_at DATETIME DEFAULT NULL,
              total_traffic_rx_bytes INTEGER DEFAULT 0,
              total_traffic_tx_bytes INTEGER DEFAULT 0,
              traffic_rx_snap TEXT DEFAULT NULL,
              traffic_tx_snap TEXT DEFAULT NULL,
              traffic_reset_at DATETIME DEFAULT NULL,
              last_seen_at DATETIME DEFAULT NULL,
              billing_price REAL DEFAULT NULL,
              billing_currency TEXT DEFAULT 'RUB',
              billing_period TEXT DEFAULT 'monthly',
              billing_paid_until DATETIME DEFAULT NULL,
              billing_status TEXT DEFAULT 'active',
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT
            );
            """
        )
        add_column_if_missing(conn, "nodes", "flag TEXT DEFAULT NULL")
        add_column_if_missing(conn, "nodes", "agent_port INTEGER DEFAULT NULL")
        for col in [
            "max_devices INTEGER DEFAULT NULL",
            "traffic_reset_interval TEXT DEFAULT NULL",
            "next_reset_at DATETIME DEFAULT NULL",
            "total_traffic_rx_bytes INTEGER DEFAULT 0",
            "total_traffic_tx_bytes INTEGER DEFAULT 0",
            "traffic_rx_snap TEXT DEFAULT NULL",
            "traffic_tx_snap TEXT DEFAULT NULL",
            "traffic_reset_at DATETIME DEFAULT NULL",
            "last_seen_at DATETIME DEFAULT NULL",
            "billing_price REAL DEFAULT NULL",
            "billing_currency TEXT DEFAULT 'RUB'",
            "billing_period TEXT DEFAULT 'monthly'",
            "billing_paid_until DATETIME DEFAULT NULL",
            "billing_status TEXT DEFAULT 'active'",
        ]:
            add_column_if_missing(conn, "users", col)


def row_to_dict(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in row.keys()}


class NodeIn(BaseModel):
    name: str
    host: str
    ssh_user: str = "root"
    ssh_port: int = 22
    ssh_key: Optional[str] = None
    ssh_password: Optional[str] = None
    base_dir: str = "/opt/mtg/users"
    start_port: int = 4433
    flag: Optional[str] = None
    agent_port: Optional[int] = None


class UserIn(BaseModel):
    name: str
    note: str = ""
    expires_at: Optional[str] = None
    traffic_limit_gb: Optional[float] = None


class UserUpdateIn(BaseModel):
    note: Optional[str] = None
    expires_at: Optional[str] = None
    traffic_limit_gb: Optional[float] = None
    max_devices: Optional[int] = None
    traffic_reset_interval: Optional[str] = None
    billing_price: Optional[float] = None
    billing_currency: Optional[str] = None
    billing_period: Optional[str] = None
    billing_paid_until: Optional[str] = None
    billing_status: Optional[str] = None


class TotpVerifyIn(BaseModel):
    code: str


def require_auth(x_auth_token: Optional[str] = Header(default=None)) -> None:
    if x_auth_token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def get_setting(key: str) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def fetch_agent_metrics(node: sqlite3.Row) -> Dict[str, dict]:
    if not node["agent_port"]:
        return {}
    req = urllib.request.Request(
        f"http://{node['host']}:{node['agent_port']}/metrics",
        headers={"x-agent-token": AGENT_TOKEN},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {}

    out: Dict[str, dict] = {}
    for c in payload.get("containers", []):
        name = c.get("name", "")
        short = name[4:] if name.startswith("mtg-") else name
        item = {
            "running": bool(c.get("running", False)),
            "status": c.get("status", "unknown"),
            "connections": int(c.get("connections", 0) or 0),
            "is_online": bool(c.get("is_online", False)),
            "traffic": c.get("traffic", {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}),
        }
        if short:
            out[short] = item
        if name:
            out[name] = item
    return out


def ssh_exec(node: sqlite3.Row, command: str, timeout: int = 20) -> str:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cfg = {
        "hostname": node["host"],
        "port": int(node["ssh_port"] or 22),
        "username": node["ssh_user"] or "root",
        "timeout": 8,
        "banner_timeout": 8,
        "auth_timeout": 8,
    }
    if node["ssh_key"]:
        pkey = None
        for cls in (paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey):
            try:
                pkey = cls.from_private_key(io.StringIO(node["ssh_key"]))
                break
            except Exception:
                continue
        if not pkey:
            raise RuntimeError("Invalid SSH key")
        cfg["pkey"] = pkey
    elif node["ssh_password"]:
        cfg["password"] = node["ssh_password"]

    client.connect(**cfg)
    try:
        _, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="ignore").strip()
        err = stderr.read().decode("utf-8", errors="ignore").strip()
        if err and not out:
            raise RuntimeError(err)
        return out
    finally:
        client.close()


def get_remote_users(node: sqlite3.Row) -> list[dict]:
    cmd = "\n".join([
        f"BASE={shlex.quote(node['base_dir'] or '/opt/mtg/users')}",
        "for DIR in $BASE/*/; do",
        "  [ -d \"$DIR\" ] || continue",
        "  NAME=$(basename \"$DIR\")",
        "  SECRET=$(grep secret \"$DIR/config.toml\" 2>/dev/null | awk -F'\"' '{print $2}')",
        "  PORT=$(grep -o '[0-9]*:3128' \"$DIR/docker-compose.yml\" 2>/dev/null | cut -d: -f1)",
        "  STATUS=$(docker ps --filter \"name=mtg-$NAME\" --format '{{.Status}}' 2>/dev/null)",
        "  CONNS=$(docker exec mtg-$NAME sh -c \"cat /proc/net/tcp 2>/dev/null | awk 'NR>1 && $4==\\\"01\\\"{c++} END{print c+0}'\" 2>/dev/null || echo 0)",
        "  echo \"USER|$NAME|$PORT|$SECRET|${STATUS:-stopped}|$CONNS\"",
        "done",
    ])
    try:
        out = ssh_exec(node, cmd)
    except Exception:
        return []

    users = []
    for line in out.splitlines():
        if not line.startswith("USER|"):
            continue
        _, name, port, secret, status, conns = line.split("|", 5)
        users.append({
            "name": name,
            "port": int(port) if port.isdigit() else None,
            "secret": secret or None,
            "status": status or "stopped",
            "connections": int(conns) if conns.isdigit() else 0,
        })
    return users


def get_remote_traffic(node: sqlite3.Row) -> dict:
    cmd = "docker stats --no-stream --format '{{.Name}}|{{.NetIO}}' 2>/dev/null | grep '^mtg-' | grep -v 'mtg-agent'"
    try:
        out = ssh_exec(node, cmd)
    except Exception:
        return {}

    result = {}
    for line in out.splitlines():
        if "|" not in line:
            continue
        name, netio = line.split("|", 1)
        user = name.replace("mtg-", "").strip()
        parts = [p.strip() for p in netio.split("/")]
        result[user] = {"rx": parts[0] if parts else "0B", "tx": parts[1] if len(parts) > 1 else "0B"}
    return result


def create_remote_user(node: sqlite3.Row, user_name: str) -> tuple[int, str]:
    safe_name = shlex.quote(user_name)
    base = shlex.quote(node["base_dir"] or "/opt/mtg/users")
    start_port = int(node["start_port"] or 4433)
    cmd = "\n".join([
        f"BASE={base}",
        f"NAME={safe_name}",
        f"START_PORT={start_port}",
        "USER_DIR=\"$BASE/$NAME\"",
        "if [ -d \"$USER_DIR\" ]; then echo EXISTS; exit 1; fi",
        "COUNT=$(ls -1 $BASE 2>/dev/null | wc -l)",
        "PORT=$((START_PORT + COUNT))",
        "SECRET=\"ee$(openssl rand -hex 16)$(echo -n 'google.com' | xxd -p)\"",
        "mkdir -p \"$USER_DIR\"",
        "printf 'secret = \"%s\"\\nbind-to = \"0.0.0.0:3128\"\\n' \"$SECRET\" > \"$USER_DIR/config.toml\"",
        "printf 'services:\n  mtg-%s:\n    image: nineseconds/mtg:2\n    container_name: mtg-%s\n    restart: unless-stopped\n    ports:\n      - \"%s:3128\"\n    volumes:\n      - %s/config.toml:/config.toml:ro\n    command: run /config.toml\n' \"$NAME\" \"$NAME\" \"$PORT\" \"$USER_DIR\" > \"$USER_DIR/docker-compose.yml\"",
        "cd \"$USER_DIR\" && docker compose up -d 2>&1",
        "echo \"OK|$PORT|$SECRET\"",
    ])
    out = ssh_exec(node, cmd, timeout=40)
    if "EXISTS" in out:
        raise RuntimeError("User already exists on node")
    ok_line = next((l for l in out.splitlines() if l.startswith("OK|")), None)
    if not ok_line:
        raise RuntimeError(f"Create user failed: {out}")
    _, port, secret = ok_line.split("|", 2)
    return int(port), secret


def remove_remote_user(node: sqlite3.Row, user_name: str) -> None:
    name = shlex.quote(user_name)
    base = shlex.quote(node["base_dir"] or "/opt/mtg/users")
    cmd = f'BASE={base}; NAME={name}; USER_DIR="$BASE/$NAME"; if [ -d "$USER_DIR" ]; then cd "$USER_DIR" && docker compose down 2>/dev/null; rm -rf "$USER_DIR"; fi; echo DONE'
    ssh_exec(node, cmd)


def stop_remote_user(node: sqlite3.Row, user_name: str) -> None:
    path = shlex.quote(f"{node['base_dir'] or '/opt/mtg/users'}/{user_name}")
    ssh_exec(node, f"cd {path} && docker compose stop 2>/dev/null")


def start_remote_user(node: sqlite3.Row, user_name: str) -> None:
    path = shlex.quote(f"{node['base_dir'] or '/opt/mtg/users'}/{user_name}")
    ssh_exec(node, f"cd {path} && docker compose start 2>/dev/null")


def iso_now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def calc_next_reset(interval: Optional[str]) -> Optional[str]:
    if not interval:
        return None
    now = datetime.now()
    if interval == "daily":
        n = now.replace(hour=0, minute=0, second=0, microsecond=0)
        n = n.replace(day=now.day)  # no-op for readability
        n = n.fromtimestamp(n.timestamp() + 86400)
    elif interval == "monthly":
        y = now.year + (1 if now.month == 12 else 0)
        m = 1 if now.month == 12 else now.month + 1
        n = now.replace(year=y, month=m, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif interval == "yearly":
        n = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        return None
    return n.strftime("%Y-%m-%d %H:%M:%S")


init_db()
app = FastAPI(title="MTG Control API (test)", version=APP_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail if isinstance(exc.detail, str) else "API error"})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    first = exc.errors()[0]["msg"] if exc.errors() else "Validation error"
    return JSONResponse(status_code=422, content={"error": first})


@app.get("/health")
def health():
    return {"ok": True, "version": APP_VERSION}


@app.get("/api/version")
def version():
    return {"version": APP_VERSION, "engine": "fastapi"}


@app.get("/api/nodes", dependencies=[Depends(require_auth)])
def list_nodes():
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name, host, ssh_user, ssh_port, base_dir, start_port, created_at, flag, agent_port FROM nodes").fetchall()
        return [row_to_dict(r) for r in rows]


@app.post("/api/nodes", dependencies=[Depends(require_auth)])
def create_node(payload: NodeIn):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO nodes (name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (payload.name, payload.host, payload.ssh_user, payload.ssh_port, payload.ssh_key, payload.ssh_password, payload.base_dir, payload.start_port, payload.flag, payload.agent_port),
        )
        return {"ok": True, "id": cur.lastrowid}


@app.put("/api/nodes/{node_id}", dependencies=[Depends(require_auth)])
def update_node(node_id: int, payload: NodeIn):
    with get_conn() as conn:
        if not conn.execute("SELECT id FROM nodes WHERE id=?", (node_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Node not found")
        conn.execute(
            "UPDATE nodes SET name=?, host=?, ssh_user=?, ssh_port=?, ssh_key=?, ssh_password=?, base_dir=?, start_port=?, flag=?, agent_port=? WHERE id=?",
            (payload.name, payload.host, payload.ssh_user, payload.ssh_port, payload.ssh_key, payload.ssh_password, payload.base_dir, payload.start_port, payload.flag, payload.agent_port, node_id),
        )
    return {"ok": True}


@app.delete("/api/nodes/{node_id}", dependencies=[Depends(require_auth)])
def delete_node(node_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM nodes WHERE id=?", (node_id,))
    return {"ok": True}


@app.get("/api/nodes/{node_id}/check-agent", dependencies=[Depends(require_auth)])
def check_agent(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    return {"available": bool(fetch_agent_metrics(node))}


@app.post("/api/nodes/{node_id}/update-agent", dependencies=[Depends(require_auth)])
def update_agent(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        token = AGENT_TOKEN
        raw = "https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/dev/mtg-agent"
        cmd = " && ".join([
            "mkdir -p /opt/mtg-agent && cd /opt/mtg-agent",
            f"wget -q '{raw}/main.py' -O main.py",
            f"wget -q '{raw}/docker-compose.yml' -O docker-compose.yml",
            f"echo 'AGENT_TOKEN={token}' > .env",
            "docker compose down 2>/dev/null || true",
            "docker compose up -d",
            "echo DONE",
        ])
        out = ssh_exec(node, cmd, timeout=60)
        return {"ok": "DONE" in out, "output": out[-800:]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/nodes/{node_id}/check", dependencies=[Depends(require_auth)])
def check_node(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        ssh_exec(node, "echo ok", timeout=8)
        return {"online": True}
    except Exception as e:
        return {"online": False, "error": str(e)}


@app.get("/api/nodes/{node_id}/traffic", dependencies=[Depends(require_auth)])
def node_traffic(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        users = conn.execute("SELECT name, traffic_rx_snap, traffic_tx_snap FROM users WHERE node_id=?", (node_id,)).fetchall()
    metrics = fetch_agent_metrics(node)
    ssh_traffic = get_remote_traffic(node) if not metrics else {}
    out = {}
    for u in users:
        name = u["name"]
        if metrics.get(name):
            out[name] = metrics[name].get("traffic", {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0})
        elif name in ssh_traffic:
            out[name] = {"rx": ssh_traffic[name].get("rx", "0B"), "tx": ssh_traffic[name].get("tx", "0B"), "rx_bytes": 0, "tx_bytes": 0}
        elif u["traffic_rx_snap"] or u["traffic_tx_snap"]:
            out[name] = {"rx": u["traffic_rx_snap"] or "—", "tx": u["traffic_tx_snap"] or "—", "rx_bytes": 0, "tx_bytes": 0}
    return out


@app.get("/api/nodes/{node_id}/users", dependencies=[Depends(require_auth)])
def list_node_users(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        db_users = conn.execute("SELECT * FROM users WHERE node_id=?", (node_id,)).fetchall()

    metrics = fetch_agent_metrics(node)
    remote = get_remote_users(node) if not metrics else []
    remote_by_name = {u["name"]: u for u in remote}

    result = []
    for row in db_users:
        u = row_to_dict(row)
        r = remote_by_name.get(u["name"], {})
        m = metrics.get(u["name"], {})
        running = m.get("running")
        if running is None:
            running = not str(r.get("status", "")).lower().startswith("stopped") if r else (u.get("status") != "stopped")
        connections = int(m.get("connections", r.get("connections", 0) or 0))
        u.update(
            {
                "running": running,
                "status": "active" if running else "stopped",
                "connections": connections,
                "is_online": bool(m.get("is_online", connections > 0)),
                "port": u.get("port") or r.get("port"),
                "secret": u.get("secret") or r.get("secret"),
                "expired": bool(u.get("expires_at") and datetime.fromisoformat(str(u["expires_at"]).replace(" ", "T")) < datetime.now()),
            }
        )
        u["link"] = f"tg://proxy?server={node['host']}&port={u.get('port') or ''}&secret={u.get('secret') or ''}"
        result.append(u)

    if node["agent_port"] and metrics:
        with get_conn() as conn:
            for u in result:
                if u.get("is_online"):
                    conn.execute("UPDATE users SET last_seen_at=datetime('now') WHERE node_id=? AND name=?", (node_id, u["name"]))
    return result


@app.post("/api/nodes/{node_id}/sync", dependencies=[Depends(require_auth)])
def sync_node(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    remote_users = get_remote_users(node)
    imported = 0
    with get_conn() as conn:
        for ru in remote_users:
            exists = conn.execute("SELECT id FROM users WHERE node_id=? AND name=?", (node_id, ru["name"])).fetchone()
            if exists:
                continue
            conn.execute(
                "INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb, status) VALUES (?, ?, ?, ?, '', NULL, NULL, ?)",
                (node_id, ru["name"], ru.get("port") or 0, ru.get("secret") or "", "active" if not str(ru.get("status", "")).lower().startswith("stopped") else "stopped"),
            )
            imported += 1
    return {"ok": True, "imported": imported, "total": len(remote_users)}


@app.post("/api/nodes/{node_id}/users", dependencies=[Depends(require_auth)])
def create_node_user(node_id: int, payload: UserIn):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        if conn.execute("SELECT id FROM users WHERE node_id=? AND name=?", (node_id, payload.name)).fetchone():
            raise HTTPException(status_code=400, detail="User already exists")
    try:
        port, secret = create_remote_user(node, payload.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
            (node_id, payload.name, port, secret, payload.note or "", payload.expires_at or None, payload.traffic_limit_gb),
        )
    return {"id": cur.lastrowid, "name": payload.name, "port": port, "secret": secret, "note": payload.note or "", "expires_at": payload.expires_at or None, "traffic_limit_gb": payload.traffic_limit_gb, "link": f"tg://proxy?server={node['host']}&port={port}&secret={secret}"}


@app.put("/api/nodes/{node_id}/users/{user_name}", dependencies=[Depends(require_auth)])
def update_node_user(node_id: int, user_name: str, payload: UserUpdateIn):
    with get_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE node_id=? AND name=?", (node_id, user_name)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        tri = payload.traffic_reset_interval if payload.traffic_reset_interval is not None else user["traffic_reset_interval"]
        next_reset = user["next_reset_at"]
        if payload.traffic_reset_interval is not None and payload.traffic_reset_interval != user["traffic_reset_interval"]:
            next_reset = calc_next_reset(payload.traffic_reset_interval)

        conn.execute(
            """
            UPDATE users SET
              note=?, expires_at=?, traffic_limit_gb=?,
              max_devices=?, traffic_reset_interval=?, next_reset_at=?,
              billing_price=?, billing_currency=?, billing_period=?, billing_paid_until=?, billing_status=?
            WHERE node_id=? AND name=?
            """,
            (
                payload.note if payload.note is not None else user["note"],
                payload.expires_at if payload.expires_at is not None else user["expires_at"],
                payload.traffic_limit_gb if payload.traffic_limit_gb is not None else user["traffic_limit_gb"],
                payload.max_devices if payload.max_devices is not None else user["max_devices"],
                tri,
                next_reset,
                payload.billing_price if payload.billing_price is not None else user["billing_price"],
                payload.billing_currency if payload.billing_currency is not None else (user["billing_currency"] or "RUB"),
                payload.billing_period if payload.billing_period is not None else (user["billing_period"] or "monthly"),
                payload.billing_paid_until if payload.billing_paid_until is not None else user["billing_paid_until"],
                payload.billing_status if payload.billing_status is not None else (user["billing_status"] or "active"),
                node_id,
                user_name,
            ),
        )
    return {"ok": True}


@app.delete("/api/nodes/{node_id}/users/{user_name}", dependencies=[Depends(require_auth)])
def delete_node_user(node_id: int, user_name: str):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        remove_remote_user(node, user_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    with get_conn() as conn:
        conn.execute("DELETE FROM users WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.post("/api/nodes/{node_id}/users/{user_name}/stop", dependencies=[Depends(require_auth)])
def stop_user(node_id: int, user_name: str):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        traffic = get_remote_traffic(node)
        if user_name in traffic:
            with get_conn() as conn:
                conn.execute("UPDATE users SET traffic_rx_snap=?, traffic_tx_snap=? WHERE node_id=? AND name=?", (traffic[user_name]["rx"], traffic[user_name]["tx"], node_id, user_name))
        stop_remote_user(node, user_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    with get_conn() as conn:
        conn.execute("UPDATE users SET status='stopped' WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.post("/api/nodes/{node_id}/users/{user_name}/start", dependencies=[Depends(require_auth)])
def start_user(node_id: int, user_name: str):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        start_remote_user(node, user_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    with get_conn() as conn:
        conn.execute("UPDATE users SET status='active' WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.post("/api/nodes/{node_id}/users/{user_name}/reset-traffic", dependencies=[Depends(require_auth)])
def reset_traffic(node_id: int, user_name: str):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        stop_remote_user(node, user_name)
        start_remote_user(node, user_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    with get_conn() as conn:
        conn.execute("UPDATE users SET traffic_reset_at=datetime('now'), traffic_rx_snap=NULL, traffic_tx_snap=NULL, status='active' WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.get("/api/nodes/{node_id}/mtg-version", dependencies=[Depends(require_auth)])
def mtg_version(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        out = ssh_exec(node, "docker inspect nineseconds/mtg:2 --format 'mtg:2 | built {{.Created}}' 2>/dev/null | head -1")
        return {"version": (out.splitlines()[0] if out else "unknown"), "raw": out}
    except Exception as e:
        return {"version": "error", "error": str(e)}


@app.post("/api/nodes/{node_id}/mtg-update", dependencies=[Depends(require_auth)])
def mtg_update(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    try:
        out = ssh_exec(node, "docker pull nineseconds/mtg:2 2>&1 | tail -3", timeout=80)
        return {"ok": True, "output": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/status", dependencies=[Depends(require_auth)])
def status():
    with get_conn() as conn:
        nodes = conn.execute("SELECT * FROM nodes").fetchall()

    results = []
    for node in nodes:
        try:
            online = True
            ssh_exec(node, "echo ok", timeout=8)
            error = None
        except Exception as e:
            online = False
            error = str(e)

        with get_conn() as conn:
            users = conn.execute("SELECT name FROM users WHERE node_id=?", (node["id"],)).fetchall()

        metrics = fetch_agent_metrics(node)
        if metrics:
            online_users = len([u for u in users if metrics.get(u["name"], {}).get("connections", 0) > 0])
        else:
            remote = get_remote_users(node)
            online_users = len([u for u in remote if int(u.get("connections", 0)) > 0])

        results.append({
            "id": node["id"],
            "name": node["name"],
            "host": node["host"],
            "online": online,
            "online_users": online_users,
            "error": error,
        })
    return results


@app.get("/api/totp/status", dependencies=[Depends(require_auth)])
def totp_status():
    return {"enabled": get_setting("totp_enabled") == "1"}


@app.post("/api/totp/setup", dependencies=[Depends(require_auth)])
def totp_setup():
    secret = pyotp.random_base32()
    set_setting("totp_secret", secret)
    set_setting("totp_enabled", "0")
    return {"secret": secret, "qr": pyotp.TOTP(secret).provisioning_uri(name="admin", issuer_name="MTG Panel")}


@app.post("/api/totp/verify", dependencies=[Depends(require_auth)])
def totp_verify(payload: TotpVerifyIn):
    secret = get_setting("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="Setup first")
    if not pyotp.TOTP(secret).verify(payload.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    set_setting("totp_enabled", "1")
    return {"ok": True}


@app.post("/api/totp/disable", dependencies=[Depends(require_auth)])
def totp_disable(payload: TotpVerifyIn):
    secret = get_setting("totp_secret")
    if secret and not pyotp.TOTP(secret).verify(payload.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    set_setting("totp_enabled", "0")
    return {"ok": True}


if PUBLIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=PUBLIC_DIR), name="assets")


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    index = PUBLIC_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="UI not found")
