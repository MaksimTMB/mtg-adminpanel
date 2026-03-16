import json
import os
import socket
import sqlite3
import urllib.error
import urllib.request
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import pyotp
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_VERSION = "0.2.0-mtg-test"
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


def add_column_if_missing(conn: sqlite3.Connection, table: str, col_sql: str, col_name: str) -> None:
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
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT
            );
            """
        )
        add_column_if_missing(conn, "nodes", "flag TEXT DEFAULT NULL", "flag")
        add_column_if_missing(conn, "nodes", "agent_port INTEGER DEFAULT NULL", "agent_port")
        add_column_if_missing(conn, "users", "max_devices INTEGER DEFAULT NULL", "max_devices")
        add_column_if_missing(conn, "users", "traffic_reset_interval TEXT DEFAULT NULL", "traffic_reset_interval")
        add_column_if_missing(conn, "users", "next_reset_at DATETIME DEFAULT NULL", "next_reset_at")
        add_column_if_missing(conn, "users", "total_traffic_rx_bytes INTEGER DEFAULT 0", "total_traffic_rx_bytes")
        add_column_if_missing(conn, "users", "total_traffic_tx_bytes INTEGER DEFAULT 0", "total_traffic_tx_bytes")
        add_column_if_missing(conn, "users", "traffic_rx_snap TEXT DEFAULT NULL", "traffic_rx_snap")
        add_column_if_missing(conn, "users", "traffic_tx_snap TEXT DEFAULT NULL", "traffic_tx_snap")
        add_column_if_missing(conn, "users", "traffic_reset_at DATETIME DEFAULT NULL", "traffic_reset_at")
        add_column_if_missing(conn, "users", "last_seen_at DATETIME DEFAULT NULL", "last_seen_at")


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
    port: int
    secret: str
    note: str = ""
    expires_at: Optional[str] = None
    traffic_limit_gb: Optional[float] = None


class UserUpdateIn(BaseModel):
    note: Optional[str] = None
    expires_at: Optional[str] = None
    traffic_limit_gb: Optional[float] = None
    max_devices: Optional[int] = None
    traffic_reset_interval: Optional[str] = None


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
    port = node["agent_port"]
    if not port:
        return {}
    url = f"http://{node['host']}:{port}/metrics"
    req = urllib.request.Request(url, headers={"x-agent-token": AGENT_TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
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


def iso_now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


init_db()

app = FastAPI(title="MTG Control API (test)", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    msg = exc.detail if isinstance(exc.detail, str) else "API error"
    return JSONResponse(status_code=exc.status_code, content={"error": msg})


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
        rows = conn.execute(
            "SELECT id, name, host, ssh_user, ssh_port, base_dir, start_port, created_at, flag, agent_port FROM nodes"
        ).fetchall()
        return [row_to_dict(r) for r in rows]


@app.post("/api/nodes", dependencies=[Depends(require_auth)])
def create_node(payload: NodeIn):
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO nodes (name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.host,
                payload.ssh_user,
                payload.ssh_port,
                payload.ssh_key,
                payload.ssh_password,
                payload.base_dir,
                payload.start_port,
                payload.flag,
                payload.agent_port,
            ),
        )
        return {"ok": True, "id": cur.lastrowid}


@app.put("/api/nodes/{node_id}", dependencies=[Depends(require_auth)])
def update_node(node_id: int, payload: NodeIn):
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Node not found")
        conn.execute(
            """
            UPDATE nodes
            SET name=?, host=?, ssh_user=?, ssh_port=?, ssh_key=?, ssh_password=?, base_dir=?, start_port=?, flag=?, agent_port=?
            WHERE id=?
            """,
            (
                payload.name,
                payload.host,
                payload.ssh_user,
                payload.ssh_port,
                payload.ssh_key,
                payload.ssh_password,
                payload.base_dir,
                payload.start_port,
                payload.flag,
                payload.agent_port,
                node_id,
            ),
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
    metrics = fetch_agent_metrics(node)
    return {"available": len(metrics) >= 0 and bool(node["agent_port"]) and (len(metrics) > 0)}


@app.post("/api/nodes/{node_id}/update-agent", dependencies=[Depends(require_auth)])
def update_agent(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT id FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    return {"ok": False, "error": "FastAPI test backend: update-agent через SSH пока не реализован"}


@app.get("/api/nodes/{node_id}/check", dependencies=[Depends(require_auth)])
def check_node(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT host, ssh_port FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    host, port = node["host"], int(node["ssh_port"] or 22)
    online = False
    error = None
    try:
        with closing(socket.create_connection((host, port), timeout=2.0)):
            online = True
    except OSError as exc:
        error = str(exc)
    return {"online": online, "error": error}


@app.get("/api/nodes/{node_id}/traffic", dependencies=[Depends(require_auth)])
def node_traffic(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        users = conn.execute("SELECT name, traffic_rx_snap, traffic_tx_snap FROM users WHERE node_id=?", (node_id,)).fetchall()

    metrics = fetch_agent_metrics(node)
    out = {}
    for u in users:
        m = metrics.get(u["name"])
        if m:
            out[u["name"]] = m.get("traffic", {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0})
        elif u["traffic_rx_snap"] or u["traffic_tx_snap"]:
            out[u["name"]] = {"rx": u["traffic_rx_snap"] or "—", "tx": u["traffic_tx_snap"] or "—", "rx_bytes": 0, "tx_bytes": 0}
    return out


@app.get("/api/nodes/{node_id}/users", dependencies=[Depends(require_auth)])
def list_node_users(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        users = conn.execute("SELECT * FROM users WHERE node_id=?", (node_id,)).fetchall()

    metrics = fetch_agent_metrics(node)
    result = []
    for u in users:
        item = row_to_dict(u)
        expires = item.get("expires_at")
        expired = False
        if expires:
            try:
                expired = datetime.fromisoformat(expires.replace(" ", "T")) < datetime.now()
            except ValueError:
                expired = False

        m = metrics.get(item["name"], {})
        running = m.get("running", item.get("status") != "stopped")
        connections = int(m.get("connections", 0))
        is_online = bool(m.get("is_online", connections > 0))

        if is_online:
            item["last_seen_at"] = iso_now()

        traffic = m.get("traffic")
        if traffic:
            item["traffic_rx_snap"] = traffic.get("rx")
            item["traffic_tx_snap"] = traffic.get("tx")
            item["total_traffic_rx_bytes"] = int(item.get("total_traffic_rx_bytes") or 0) + int(traffic.get("rx_bytes", 0) or 0)
            item["total_traffic_tx_bytes"] = int(item.get("total_traffic_tx_bytes") or 0) + int(traffic.get("tx_bytes", 0) or 0)

        item.update(
            {
                "running": running,
                "status": "active" if running else "stopped",
                "connections": connections,
                "is_online": is_online,
                "expired": expired,
                "link": f"tg://proxy?server={node['host']}&port={item['port']}&secret={item['secret']}",
            }
        )
        result.append(item)

    return result


@app.post("/api/nodes/{node_id}/users", dependencies=[Depends(require_auth)])
def create_node_user(node_id: int, payload: UserIn):
    with get_conn() as conn:
        node = conn.execute("SELECT id FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        cur = conn.execute(
            """
            INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
            """,
            (
                node_id,
                payload.name,
                payload.port,
                payload.secret,
                payload.note,
                payload.expires_at,
                payload.traffic_limit_gb,
            ),
        )
        return {"ok": True, "id": cur.lastrowid, "name": payload.name, "port": payload.port, "secret": payload.secret}


@app.put("/api/nodes/{node_id}/users/{user_name}", dependencies=[Depends(require_auth)])
def update_node_user(node_id: int, user_name: str, payload: UserUpdateIn):
    with get_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE node_id=? AND name=?", (node_id, user_name)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        note = payload.note if payload.note is not None else user["note"]
        expires_at = payload.expires_at if payload.expires_at is not None else user["expires_at"]
        traffic_limit_gb = payload.traffic_limit_gb if payload.traffic_limit_gb is not None else user["traffic_limit_gb"]
        max_devices = payload.max_devices if payload.max_devices is not None else user["max_devices"]
        tri = payload.traffic_reset_interval if payload.traffic_reset_interval is not None else user["traffic_reset_interval"]

        conn.execute(
            """
            UPDATE users
            SET note=?, expires_at=?, traffic_limit_gb=?, max_devices=?, traffic_reset_interval=?
            WHERE node_id=? AND name=?
            """,
            (note, expires_at, traffic_limit_gb, max_devices, tri, node_id, user_name),
        )
    return {"ok": True}


@app.delete("/api/nodes/{node_id}/users/{user_name}", dependencies=[Depends(require_auth)])
def delete_node_user(node_id: int, user_name: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM users WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.post("/api/nodes/{node_id}/users/{user_name}/start", dependencies=[Depends(require_auth)])
def start_user(node_id: int, user_name: str):
    with get_conn() as conn:
        conn.execute("UPDATE users SET status='active' WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.post("/api/nodes/{node_id}/users/{user_name}/stop", dependencies=[Depends(require_auth)])
def stop_user(node_id: int, user_name: str):
    with get_conn() as conn:
        conn.execute("UPDATE users SET status='stopped' WHERE node_id=? AND name=?", (node_id, user_name))
    return {"ok": True}


@app.post("/api/nodes/{node_id}/users/{user_name}/reset-traffic", dependencies=[Depends(require_auth)])
def reset_traffic(node_id: int, user_name: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET traffic_rx_snap='0B', traffic_tx_snap='0B', traffic_reset_at=? WHERE node_id=? AND name=?",
            (iso_now(), node_id, user_name),
        )
    return {"ok": True}


@app.post("/api/nodes/{node_id}/sync", dependencies=[Depends(require_auth)])
def sync_node(node_id: int):
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM users WHERE node_id=?", (node_id,)).fetchone()["c"]
    return {"ok": True, "imported": 0, "total": total}


@app.get("/api/nodes/{node_id}/mtg-version", dependencies=[Depends(require_auth)])
def mtg_version(node_id: int):
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Node not found")
    return {"version": "mtg:2 (unknown)", "raw": "FastAPI test backend: no SSH inspect"}


@app.post("/api/nodes/{node_id}/mtg-update", dependencies=[Depends(require_auth)])
def mtg_update(node_id: int):
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Node not found")
    return {"ok": False, "output": "FastAPI test backend: mtg-update через SSH пока не реализован"}


@app.get("/api/status", dependencies=[Depends(require_auth)])
def status():
    with get_conn() as conn:
        nodes = conn.execute("SELECT * FROM nodes").fetchall()

    data = []
    for n in nodes:
        users_count = 0
        online_users = 0
        online = False
        error = None

        try:
            with closing(socket.create_connection((n["host"], int(n["ssh_port"] or 22)), timeout=1.5)):
                online = True
        except OSError as exc:
            error = str(exc)

        with get_conn() as conn:
            users = conn.execute("SELECT name, status FROM users WHERE node_id=?", (n["id"],)).fetchall()
            users_count = len(users)

        metrics = fetch_agent_metrics(n)
        if metrics:
            for u in users:
                if metrics.get(u["name"], {}).get("connections", 0) > 0:
                    online_users += 1
        else:
            online_users = 0

        data.append(
            {
                "id": n["id"],
                "name": n["name"],
                "host": n["host"],
                "online": online,
                "users": users_count,
                "online_users": online_users,
                "error": error,
            }
        )
    return data


@app.get("/api/totp/status", dependencies=[Depends(require_auth)])
def totp_status():
    return {"enabled": get_setting("totp_enabled") == "1"}


@app.post("/api/totp/setup", dependencies=[Depends(require_auth)])
def totp_setup():
    secret = pyotp.random_base32()
    set_setting("totp_secret", secret)
    set_setting("totp_enabled", "0")
    uri = pyotp.TOTP(secret).provisioning_uri(name="admin", issuer_name="MTG Panel")
    return {"secret": secret, "qr": uri}


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
