const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'mtg-panel.db'));
db.pragma('foreign_keys = ON');

db.exec(`
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS connections_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    connections INTEGER DEFAULT 0,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrate existing tables if needed
try { db.exec("ALTER TABLE users ADD COLUMN note TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN expires_at DATETIME DEFAULT NULL"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN traffic_limit_gb REAL DEFAULT NULL"); } catch {}
try { db.exec("ALTER TABLE nodes ADD COLUMN domain TEXT"); } catch {}

module.exports = db;
