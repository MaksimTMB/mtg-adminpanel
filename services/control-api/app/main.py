import os
import sqlite3
import socket
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Optional

import pyotp
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_VERSION = "0.1.0-mtg-test"
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "changeme")
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "mtg-panel.db"
PUBLIC_DIR = Path(os.getenv("PUBLIC_DIR", "/app/public"))

DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
              total_traffic_rx_bytes INTEGER DEFAULT 0,
              total_traffic_tx_bytes INTEGER DEFAULT 0,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT
            );
            """
        )


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


init_db()

app = FastAPI(title="MTG Control API (test)", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/nodes/{node_id}/users", dependencies=[Depends(require_auth)])
def list_node_users(node_id: int):
    with get_conn() as conn:
        node = conn.execute("SELECT id, host FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        users = conn.execute("SELECT * FROM users WHERE node_id=?", (node_id,)).fetchall()

    result = []
    for u in users:
        item = row_to_dict(u)
        expires = item.get("expires_at")
        expired = False
        if expires:
            try:
                expired = datetime.fromisoformat(expires) < datetime.now()
            except ValueError:
                expired = False
        item.update(
            {
                "connections": 0,
                "running": False,
                "is_online": False,
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
            INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb)
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
        return {"ok": True, "id": cur.lastrowid}


@app.get("/api/status", dependencies=[Depends(require_auth)])
def status():
    with get_conn() as conn:
        nodes = conn.execute("SELECT id, name, host FROM nodes").fetchall()
        data = []
        for n in nodes:
            users_count = conn.execute("SELECT COUNT(*) AS c FROM users WHERE node_id=?", (n["id"],)).fetchone()["c"]
            data.append(
                {
                    "id": n["id"],
                    "name": n["name"],
                    "host": n["host"],
                    "online": True,
                    "users": users_count,
                    "online_users": 0,
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
