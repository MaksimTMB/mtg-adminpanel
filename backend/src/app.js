require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('./db');
const ssh     = require('./ssh');
const nodeCache = require('./nodeCache');
const authenticator = require('./totp');

// ── Config ────────────────────────────────────────────────
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'changeme';
const PORT       = process.env.PORT || 3000;

// Version: /app/src/app.js → ../package.json = /app/package.json = backend/package.json in Docker
let pkgVersion = 'unknown';
try { pkgVersion = require('../package.json').version; } catch (_) {}

// ── DB Migrations ─────────────────────────────────────────
function runMigrations() {
  const migrations = [
    "ALTER TABLE nodes ADD COLUMN flag TEXT DEFAULT NULL",
    "ALTER TABLE nodes ADD COLUMN agent_port INTEGER DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN traffic_rx_snap TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN traffic_tx_snap TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN traffic_reset_at DATETIME DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN last_seen_at DATETIME DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN billing_price REAL DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN billing_currency TEXT DEFAULT 'RUB'",
    "ALTER TABLE users ADD COLUMN billing_period TEXT DEFAULT 'monthly'",
    "ALTER TABLE users ADD COLUMN billing_paid_until DATETIME DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN billing_status TEXT DEFAULT 'active'",
    // v1.7.0 — device limits & auto traffic reset
    "ALTER TABLE users ADD COLUMN max_devices INTEGER DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN traffic_reset_interval TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN next_reset_at DATETIME DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN total_traffic_rx_bytes INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN total_traffic_tx_bytes INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN traffic_carry_rx_bytes INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN traffic_carry_tx_bytes INTEGER DEFAULT 0",
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (_) {}
  }
}
runMigrations();

// ── Node cache (background polling every 10s) ─────────────
nodeCache.start(db);

// ── App ───────────────────────────────────────────────────
const app = express();
app.use(cors({ exposedHeaders: ['x-totp-session'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Public endpoints (no auth) ────────────────────────────
app.get('/api/version', (req, res) => {
  res.json({ version: pkgVersion });
});

const fs = require('fs');
const LOGO_PATH = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'logo.json') : path.join(__dirname, '../../data/logo.json');

app.get('/logo', (req, res) => {
  try {
    if (!fs.existsSync(LOGO_PATH)) return res.status(404).end();
    const { data } = JSON.parse(fs.readFileSync(LOGO_PATH, 'utf8'));
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).end();
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buf);
  } catch { res.status(500).end(); }
});

// ── TOTP Session store (SQLite-backed, 24h TTL) ───────────
db.prepare(`CREATE TABLE IF NOT EXISTS totp_sessions (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
)`).run();

function _createTotpSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('INSERT OR REPLACE INTO totp_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);
  return token;
}
function _isValidTotpSession(token) {
  if (!token || token.length < 10) return false;
  const row = db.prepare('SELECT expires_at FROM totp_sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (Date.now() > row.expires_at) { db.prepare('DELETE FROM totp_sessions WHERE token = ?').run(token); return false; }
  return true;
}
// Clean expired sessions hourly
setInterval(() => {
  db.prepare('DELETE FROM totp_sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000);

// ── Auth middleware ───────────────────────────────────────
app.use('/api', (req, res, next) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  // TOTP validation — exempt setup/verify/status (needed to configure 2FA itself)
  const totpExempt = ['/totp/setup', '/totp/verify', '/totp/status', '/totp/disable', '/totp/session'];
  if (isTotpEnabled() && !totpExempt.some(p => req.path.startsWith(p))) {
    const code = req.headers['x-totp-code'];
    // Accept valid session token (issued after first TOTP verification)
    if (_isValidTotpSession(code)) { next(); return; }
    // Accept valid TOTP code — issue session token for subsequent requests
    const secret = getTotpSecret();
    if (!code || !authenticator.verify(code, secret)) {
      return res.status(403).json({ error: 'TOTP required', totp: true });
    }
    res.setHeader('x-totp-session', _createTotpSession());
  }
  next();
});

// ── TOTP 2FA ──────────────────────────────────────────────
const TOTP_ISSUER = 'MTG Panel';

// In-memory TOTP cache — avoids a DB hit on every API request
let _totpCache = null;
function _loadTotpCache() {
  const secret  = db.prepare("SELECT value FROM settings WHERE key='totp_secret'").get();
  const enabled = db.prepare("SELECT value FROM settings WHERE key='totp_enabled'").get();
  _totpCache = { secret: secret ? secret.value : null, enabled: enabled && enabled.value === '1' };
}
function _invalidateTotpCache() { _totpCache = null; }
function getTotpSecret()  { if (!_totpCache) _loadTotpCache(); return _totpCache.secret; }
function isTotpEnabled()  { if (!_totpCache) _loadTotpCache(); return _totpCache.enabled; }

app.get('/api/totp/status', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ enabled: isTotpEnabled() });
});
app.post('/api/totp/setup', async (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const secret = authenticator.generateSecret();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_secret', ?)").run(secret);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '0')").run();
  _invalidateTotpCache();
  res.json({ secret, qr: authenticator.keyuri('admin', TOTP_ISSUER, secret) });
});
app.post('/api/totp/verify', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { code } = req.body;
  const secret = getTotpSecret();
  if (!secret) return res.status(400).json({ error: 'Setup first' });
  if (authenticator.verify(code, secret)) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '1')").run();
    _invalidateTotpCache();
    res.json({ ok: true });
  } else { res.status(400).json({ error: 'Invalid code' }); }
});
app.post('/api/totp/session', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { code } = req.body;
  const secret = getTotpSecret();
  if (!secret || !isTotpEnabled()) return res.status(400).json({ error: '2FA disabled' });
  if (!code || !authenticator.verify(code, secret)) {
    return res.status(403).json({ error: 'Invalid code', totp: true });
  }
  res.json({ ok: true, session: _createTotpSession() });
});
app.post('/api/totp/disable', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { code } = req.body;
  const secret = getTotpSecret();
  if (secret && !authenticator.verify(code, secret)) {
    return res.status(400).json({ error: 'Invalid code' });
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '0')").run();
  _invalidateTotpCache();
  res.json({ ok: true });
});

// ── Logo ──────────────────────────────────────────────────
app.post('/api/settings/logo', (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !data.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image data' });
    const dir = path.dirname(LOGO_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOGO_PATH, JSON.stringify({ data }));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/settings/logo', (req, res) => {
  try {
    if (fs.existsSync(LOGO_PATH)) fs.unlinkSync(LOGO_PATH);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Nodes ─────────────────────────────────────────────────
app.get('/api/nodes', (req, res) => {
  res.json(db.prepare('SELECT id, name, host, ssh_user, ssh_port, base_dir, start_port, created_at, flag, agent_port FROM nodes').all());
});

// Fast DB-only counts — zero SSH/agent calls, used by dashboard
app.get('/api/nodes/counts', (req, res) => {
  const rows = db.prepare('SELECT node_id, COUNT(*) as count FROM users GROUP BY node_id').all();
  const counts = {};
  for (const r of rows) counts[r.node_id] = r.count;
  res.json(counts);
});

app.post('/api/nodes', async (req, res) => {
  const { name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port, auto_install_agent } = req.body;
  if (!name || !host) return res.status(400).json({ error: 'name и host обязательны' });
  const result = db.prepare(
    'INSERT INTO nodes (name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, host, ssh_user||'root', ssh_port||22, ssh_key||null, ssh_password||null, base_dir||'/opt/mtg/users', start_port||4433, flag||null, agent_port||8081);
  const nodeId = result.lastInsertRowid;
  res.json({ id: nodeId, name, host });

  // Auto-install agent in background if SSH creds provided
  if ((ssh_key || ssh_password) && auto_install_agent !== false) {
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
    const token = process.env.AGENT_TOKEN || 'mtg-agent-secret';
    const RAW = 'https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent';
    const cmd = [
      `mkdir -p /opt/mtg-agent && cd /opt/mtg-agent`,
      `wget -q "${RAW}/main.py" -O main.py || curl -fsSL "${RAW}/main.py" -o main.py`,
      `wget -q "${RAW}/docker-compose.yml" -O docker-compose.yml || curl -fsSL "${RAW}/docker-compose.yml" -o docker-compose.yml`,
      `echo "AGENT_TOKEN=${token}" > .env`,
      `docker compose down 2>/dev/null || true`,
      `docker compose up -d`,
      `echo "==> Done"`
    ].join(' && ');
    ssh.sshExec(node, cmd)
      .then(r => console.log(`✅ Agent auto-installed on node ${nodeId}: ${r.output.slice(-100)}`))
      .catch(e => console.warn(`⚠️ Agent auto-install failed on node ${nodeId}: ${e.message}`));
  }
});

app.put('/api/nodes/:id', (req, res) => {
  const { name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port } = req.body;
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  db.prepare(
    'UPDATE nodes SET name=?, host=?, ssh_user=?, ssh_port=?, ssh_key=?, ssh_password=?, base_dir=?, start_port=?, flag=?, agent_port=? WHERE id=?'
  ).run(
    name||node.name, host||node.host, ssh_user||node.ssh_user, ssh_port||node.ssh_port,
    ssh_key!==undefined ? ssh_key : node.ssh_key,
    ssh_password!==undefined ? ssh_password : node.ssh_password,
    base_dir||node.base_dir, start_port||node.start_port,
    flag!==undefined ? flag : node.flag,
    agent_port!==undefined ? (agent_port||null) : node.agent_port,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/nodes/:id', (req, res) => {
  db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Check agent health on a node
app.get('/api/nodes/:id/check-agent', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  if (!node.agent_port) return res.json({ available: false, reason: 'no agent_port configured' });
  try {
    const ok = await ssh.checkAgentHealth(node);
    res.json({ available: ok });
  } catch (e) {
    res.json({ available: false, reason: e.message });
  }
});

// Update agent on node via SSH
app.post('/api/nodes/:id/update-agent', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  const token = process.env.AGENT_TOKEN || 'mtg-agent-secret';
  const RAW = 'https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent';
  const cmd = [
    `mkdir -p /opt/mtg-agent && cd /opt/mtg-agent`,
    `wget -q "${RAW}/main.py" -O main.py || curl -fsSL "${RAW}/main.py" -o main.py`,
    `wget -q "${RAW}/docker-compose.yml" -O docker-compose.yml || curl -fsSL "${RAW}/docker-compose.yml" -o docker-compose.yml`,
    `echo "AGENT_TOKEN=${token}" > .env`,
    `docker compose down 2>/dev/null || true`,
    `docker compose up -d`,
    `echo "==> Done"`
  ].join(' && ');
  try {
    const r = await ssh.sshExec(node, cmd);
    const ok = r.output.includes('Done');
    res.json({ ok, output: r.output.slice(-800) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/nodes/:id/check', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  try { res.json({ online: await ssh.checkNode(node) }); }
  catch (e) { res.json({ online: false, error: e.message }); }
});

app.get('/api/nodes/:id/traffic', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  try { res.json(await ssh.getTraffic(node)); }
  catch (_) { res.json({}); }
});

// Combined endpoint: instant — served from background cache
app.get('/api/nodes/:id/summary', (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });

  const cached = nodeCache.get(node.id);
  const remote = cached.remoteUsers;
  const dbUsers = db.prepare('SELECT * FROM users WHERE node_id = ?').all(node.id);

  const traffic = {};
  for (const u of remote) {
    if (u.traffic) traffic[u.name] = { rx: u.traffic.rx || '—', tx: u.traffic.tx || '—' };
  }

  function mkUser(u, r) {
    const trafficState = buildTrafficState(u, r?.traffic || null);
    return {
      ...u,
      port:        r?.port        || u.port,
      secret:      r?.secret      || u.secret,
      running:     r ? (r.running === true || (r.status || '').includes('Up')) : false,
      connections: r?.connections || 0,
      is_online:   (r?.connections || 0) > 0,
      traffic:     r?.traffic     || null,
      current_traffic_rx_bytes: trafficState.current.rxBytes,
      current_traffic_tx_bytes: trafficState.current.txBytes,
      current_traffic_rx: bytesToSize(trafficState.current.rxBytes),
      current_traffic_tx: bytesToSize(trafficState.current.txBytes),
      lifetime_traffic_rx_bytes: trafficState.lifetime.rxBytes,
      lifetime_traffic_tx_bytes: trafficState.lifetime.txBytes,
      lifetime_traffic_rx: bytesToSize(trafficState.lifetime.rxBytes),
      lifetime_traffic_tx: bytesToSize(trafficState.lifetime.txBytes),
      link: `tg://proxy?server=${node.host}&port=${u.port}&secret=${u.secret}`,
      expired: u.expires_at ? new Date(u.expires_at) < new Date() : false,
    };
  }
  const users = dbUsers.map(u => mkUser(u, remote.find(r => r.name === u.name)));
  res.json({ online: cached.status.online, users, traffic });
});

// Agent version — from background cache, instant
app.get('/api/nodes/:id/agent-version', (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  const cached = nodeCache.get(node.id);
  const version = cached.agentVersion;
  res.json({ version, available: version !== null, online: cached.status.online });
});

app.get('/api/nodes/:id/mtg-version', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await ssh.sshExec(node, "docker inspect nineseconds/mtg:2 --format 'mtg:2 | built {{.Created}}' 2>/dev/null | head -1");
    res.json({ version: (r.output||'').trim().split('\n')[0]||'unknown', raw: r.output });
  } catch (e) { res.json({ version: 'error', error: e.message }); }
});

app.post('/api/nodes/:id/mtg-update', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await ssh.sshExec(node, 'docker pull nineseconds/mtg:2 2>&1 | tail -3');
    res.json({ ok: true, output: r.output });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/status', (req, res) => {
  // Instant — served from in-memory cache, never waits for SSH/agent
  const nodes = db.prepare('SELECT * FROM nodes').all();
  res.json(nodes.map(node => {
    const cached = nodeCache.get(node.id);
    return { id: node.id, name: node.name, host: node.host, ...cached.status };
  }));
});

// ── Users ─────────────────────────────────────────────────
app.get('/api/nodes/:id/users', (req, res) => {
  // Instant — served from background cache, never waits for SSH/agent
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  const dbUsers = db.prepare('SELECT * FROM users WHERE node_id = ?').all(req.params.id);
  const remoteUsers = nodeCache.get(node.id).remoteUsers;

  const mkUser = (u, remote) => ({
    ...(() => {
      const trafficState = buildTrafficState(u, remote?.traffic || null);
      return {
        ...u,
        connections: remote?.connections || 0,
        running: remote ? (remote.running === true || (remote.status || '').includes('Up')) : false,
        is_online: (remote?.connections || 0) > 0,
        traffic_rx: remote?.traffic?.rx || null,
        traffic_tx: remote?.traffic?.tx || null,
        current_traffic_rx_bytes: trafficState.current.rxBytes,
        current_traffic_tx_bytes: trafficState.current.txBytes,
        current_traffic_rx: bytesToSize(trafficState.current.rxBytes),
        current_traffic_tx: bytesToSize(trafficState.current.txBytes),
        lifetime_traffic_rx_bytes: trafficState.lifetime.rxBytes,
        lifetime_traffic_tx_bytes: trafficState.lifetime.txBytes,
        lifetime_traffic_rx: bytesToSize(trafficState.lifetime.rxBytes),
        lifetime_traffic_tx: bytesToSize(trafficState.lifetime.txBytes),
        link: `tg://proxy?server=${node.host}&port=${u.port}&secret=${u.secret}`,
        expired: u.expires_at ? new Date(u.expires_at) < new Date() : false,
      };
    })()
  });

  // Device limit enforcement (async, doesn't block response)
  for (const remote of remoteUsers) {
    const dbUser = dbUsers.find(u => u.name === remote.name);
    if (dbUser && dbUser.max_devices && (remote.connections || 0) > dbUser.max_devices) {
      persistTrafficCarry(req.params.id, remote.name, remote.traffic || null);
      ssh.stopRemoteUser(node, remote.name).catch(() => {});
      db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', req.params.id, remote.name);
      remote.status = 'stopped'; remote.connections = 0;
    }
    if ((remote.connections || 0) > 0) {
      db.prepare("UPDATE users SET last_seen_at=datetime('now') WHERE node_id=? AND name=?")
        .run(req.params.id, remote.name);
    }
  }

  res.json(dbUsers.map(u => mkUser(u, remoteUsers.find(r => r.name === u.name))));
});

app.post('/api/nodes/:id/sync', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    const remoteUsers = await ssh.getRemoteUsers(node);
    let imported = 0;
    for (const u of remoteUsers) {
      // Skip agent-sourced entries without port/secret (agent doesn't read config files)
      if (u.port === null || u.secret === null) continue;
      const exists = db.prepare('SELECT id FROM users WHERE node_id = ? AND name = ?').get(req.params.id, u.name);
      if (!exists) {
        db.prepare('INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(req.params.id, u.name, u.port, u.secret, '', null, null);
        imported++;
      }
    }
    res.json({ imported, total: remoteUsers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/nodes/:id/users', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const { name, note, expires_at, traffic_limit_gb } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) return res.status(400).json({ error: 'Имя: только буквы, цифры, _ и - (макс 32 символа)' });
  if (db.prepare('SELECT id FROM users WHERE node_id = ? AND name = ?').get(req.params.id, name)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  try {
    const { port, secret } = await ssh.createRemoteUser(node, name);
    const result = db.prepare(
      'INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, name, port, secret, note||'', expires_at||null, traffic_limit_gb||null);
    nodeCache.refresh(node);
    res.json({ id: result.lastInsertRowid, name, port, secret, note: note||'',
      expires_at: expires_at||null, traffic_limit_gb: traffic_limit_gb||null,
      link: `tg://proxy?server=${node.host}&port=${port}&secret=${secret}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/nodes/:id/users/:name', (req, res) => {
  const { note, expires_at, traffic_limit_gb, billing_price, billing_currency, billing_period,
    billing_paid_until, billing_status, max_devices, traffic_reset_interval } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE node_id = ? AND name = ?').get(req.params.id, req.params.name);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Calculate next_reset_at if interval changed
  let next_reset_at = user.next_reset_at;
  const newInterval = traffic_reset_interval !== undefined ? traffic_reset_interval : user.traffic_reset_interval;
  if (traffic_reset_interval !== undefined && traffic_reset_interval !== user.traffic_reset_interval) {
    next_reset_at = calcNextReset(traffic_reset_interval);
  }

  db.prepare(`UPDATE users SET
    note=?, expires_at=?, traffic_limit_gb=?,
    billing_price=?, billing_currency=?, billing_period=?, billing_paid_until=?, billing_status=?,
    max_devices=?, traffic_reset_interval=?, next_reset_at=?
    WHERE node_id=? AND name=?`).run(
    note!==undefined ? note : user.note,
    expires_at!==undefined ? expires_at : user.expires_at,
    traffic_limit_gb!==undefined ? traffic_limit_gb : user.traffic_limit_gb,
    billing_price!==undefined ? billing_price : user.billing_price,
    billing_currency||user.billing_currency||'RUB',
    billing_period||user.billing_period||'monthly',
    billing_paid_until!==undefined ? billing_paid_until : user.billing_paid_until,
    billing_status||user.billing_status||'active',
    max_devices!==undefined ? max_devices : user.max_devices,
    newInterval||null,
    next_reset_at||null,
    req.params.id, req.params.name
  );
  res.json({ ok: true });
});

app.delete('/api/nodes/:id/users/:name', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    await ssh.removeRemoteUser(node, req.params.name);
    db.prepare('DELETE FROM users WHERE node_id = ? AND name = ?').run(req.params.id, req.params.name);
    nodeCache.refresh(node);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stop: save traffic snapshot before stopping so UI keeps last known value
app.post('/api/nodes/:id/users/:name/stop', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    // Save traffic snapshot from cache before stopping
    const cached = nodeCache.get(node.id);
    const cachedUser = cached.remoteUsers.find(u => u.name === req.params.name);
    persistTrafficCarry(req.params.id, req.params.name, cachedUser?.traffic || null);
    await ssh.stopRemoteUser(node, req.params.name);
    db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', req.params.id, req.params.name);
    nodeCache.refresh(node);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/nodes/:id/users/:name/start', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    await ssh.startRemoteUser(node, req.params.name);
    db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('active', req.params.id, req.params.name);
    nodeCache.refresh(node);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset traffic: restart container (clears MTG counter) + record timestamp
app.post('/api/nodes/:id/users/:name/reset-traffic', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    // Accumulate current live traffic into total before resetting
    const cached = nodeCache.get(node.id);
    const cachedUser = cached?.remoteUsers?.find(u => u.name === req.params.name);
    flushCurrentTrafficToLifetime(req.params.id, req.params.name, cachedUser?.traffic || null);
    await ssh.restartRemoteUser(node, req.params.name);
    db.prepare(`UPDATE users SET
      traffic_reset_at=datetime('now'), traffic_rx_snap=NULL, traffic_tx_snap=NULL,
      traffic_carry_rx_bytes=0, traffic_carry_tx_bytes=0, status='active' WHERE node_id=? AND name=?`
    ).run(req.params.id, req.params.name);
    nodeCache.refresh(node);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nodes/:id/users/:name/history', (req, res) => {
  const rows = db.prepare(
    'SELECT connections, recorded_at FROM connections_history WHERE node_id=? AND user_name=? ORDER BY recorded_at DESC LIMIT 48'
  ).all(req.params.id, req.params.name);
  res.json(rows.reverse());
});

// ── Debug endpoint: shows full diagnostic info ─────────────
app.get('/api/nodes/:id/debug', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });

  const report = {
    node: { id: node.id, name: node.name, host: node.host, agent_port: node.agent_port, base_dir: node.base_dir },
    nodeCache: nodeCache.get(node.id),
    agentDirect: null,
    agentDirectError: null,
    agentUsersRaw: null,
    agentUsersError: null,
  };

  // Direct agent health check
  if (node.agent_port) {
    try {
      report.agentDirect = await ssh.agentGetPublic(node, '/health');
    } catch (e) {
      report.agentDirectError = e.message;
    }
    try {
      report.agentUsersRaw = await ssh.agentGetPublic(node, '/users');
    } catch (e) {
      report.agentUsersError = e.message;
    }
  }

  console.log('[DEBUG]', JSON.stringify(report, null, 2));
  res.json(report);
});

// ── SPA fallback ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Helpers ───────────────────────────────────────────────
function calcNextReset(interval) {
  if (!interval || interval === 'never') return null;
  const now = new Date();
  if (interval === 'daily')   { now.setDate(now.getDate() + 1); now.setHours(0,0,0,0); }
  if (interval === 'monthly') { now.setMonth(now.getMonth() + 1); now.setDate(1); now.setHours(0,0,0,0); }
  if (interval === 'yearly')  { now.setFullYear(now.getFullYear() + 1); now.setMonth(0); now.setDate(1); now.setHours(0,0,0,0); }
  return now.toISOString().replace('T',' ').slice(0,19);
}

function parseBytes(str) {
  if (!str) return 0;
  const m = str.match(/([\d.]+)(GB|MB|KB|B)/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === 'GB') return Math.round(v * 1073741824);
  if (u === 'MB') return Math.round(v * 1048576);
  if (u === 'KB') return Math.round(v * 1024);
  return Math.round(v);
}

function bytesToSize(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0B';
  if (value >= 1073741824) return `${trimDecimals(value / 1073741824)}GB`;
  if (value >= 1048576) return `${trimDecimals(value / 1048576)}MB`;
  if (value >= 1024) return `${trimDecimals(value / 1024)}KB`;
  return `${Math.round(value)}B`;
}

function trimDecimals(num) {
  return Number(num.toFixed(num >= 10 ? 1 : 2)).toString();
}

function buildTrafficState(user, liveTraffic = null) {
  const carryRx = user?.traffic_carry_rx_bytes || 0;
  const carryTx = user?.traffic_carry_tx_bytes || 0;
  const liveRx = liveTraffic?.rx ? parseBytes(liveTraffic.rx) : 0;
  const liveTx = liveTraffic?.tx ? parseBytes(liveTraffic.tx) : 0;
  const snapRx = !liveRx && !carryRx && user?.traffic_rx_snap ? parseBytes(user.traffic_rx_snap) : 0;
  const snapTx = !liveTx && !carryTx && user?.traffic_tx_snap ? parseBytes(user.traffic_tx_snap) : 0;
  const currentRx = carryRx + (liveRx || snapRx);
  const currentTx = carryTx + (liveTx || snapTx);
  const totalRx = (user?.total_traffic_rx_bytes || 0) + currentRx;
  const totalTx = (user?.total_traffic_tx_bytes || 0) + currentTx;

  return {
    current: { rxBytes: currentRx, txBytes: currentTx },
    lifetime: { rxBytes: totalRx, txBytes: totalTx },
  };
}

function persistTrafficCarry(nodeId, userName, liveTraffic = null) {
  const user = db.prepare(`
    SELECT traffic_carry_rx_bytes, traffic_carry_tx_bytes, traffic_rx_snap, traffic_tx_snap
    FROM users WHERE node_id=? AND name=?
  `).get(nodeId, userName);
  if (!user) return;
  const nextCarryRx = (user.traffic_carry_rx_bytes || 0) + (liveTraffic?.rx ? parseBytes(liveTraffic.rx) : 0);
  const nextCarryTx = (user.traffic_carry_tx_bytes || 0) + (liveTraffic?.tx ? parseBytes(liveTraffic.tx) : 0);
  db.prepare(`
    UPDATE users SET
      traffic_carry_rx_bytes=?,
      traffic_carry_tx_bytes=?,
      traffic_rx_snap=?,
      traffic_tx_snap=?
    WHERE node_id=? AND name=?
  `).run(
    nextCarryRx,
    nextCarryTx,
    bytesToSize(nextCarryRx),
    bytesToSize(nextCarryTx),
    nodeId,
    userName
  );
}

function flushCurrentTrafficToLifetime(nodeId, userName, liveTraffic = null) {
  const user = db.prepare(`
    SELECT total_traffic_rx_bytes, total_traffic_tx_bytes, traffic_carry_rx_bytes, traffic_carry_tx_bytes, traffic_rx_snap, traffic_tx_snap
    FROM users WHERE node_id=? AND name=?
  `).get(nodeId, userName);
  if (!user) return;
  const current = buildTrafficState(user, liveTraffic).current;
  db.prepare(`
    UPDATE users SET
      total_traffic_rx_bytes=?,
      total_traffic_tx_bytes=?,
      traffic_carry_rx_bytes=0,
      traffic_carry_tx_bytes=0
    WHERE node_id=? AND name=?
  `).run(
    (user.total_traffic_rx_bytes || 0) + current.rxBytes,
    (user.total_traffic_tx_bytes || 0) + current.txBytes,
    nodeId,
    userName
  );
}

// ── Background jobs ───────────────────────────────────────

// Fetch a single node's data and enforce limits/resets.
// All nodes run in parallel via Promise.allSettled in recordHistory().
async function processNode(node) {
  const remoteUsers = await ssh.getRemoteUsers(node);
  const traffic = await ssh.getTraffic(node).catch(() => ({}));
  // Pre-load all DB users for this node in one query
  const dbUsers = db.prepare('SELECT * FROM users WHERE node_id=?').all(node.id);
  const dbMap = Object.fromEntries(dbUsers.map(u => [u.name, u]));

  for (const u of remoteUsers) {
    const conns  = u.connections || 0;
    const dbUser = dbMap[u.name];

    db.prepare('INSERT INTO connections_history (node_id, user_name, connections) VALUES (?, ?, ?)')
      .run(node.id, u.name, conns);

    if (conns > 0) {
      db.prepare("UPDATE users SET last_seen_at=datetime('now') WHERE node_id=? AND name=?")
        .run(node.id, u.name);
    }

    if (!dbUser) continue;

    // Device limit enforcement
    if (dbUser.max_devices && conns > dbUser.max_devices) {
      console.log(`⚠️ Device limit: ${u.name}@${node.id} (${conns}/${dbUser.max_devices})`);
      try {
        persistTrafficCarry(node.id, u.name, u.traffic || traffic[u.name] || null);
        await ssh.stopRemoteUser(node, u.name);
        db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', node.id, u.name);
        console.log(`🛑 Stopped ${u.name}: device limit`);
      } catch (e) { console.error(`Stop failed (device limit) ${u.name}:`, e.message); }
    }

    // Traffic limit enforcement
    if (dbUser.traffic_limit_gb && dbUser.status !== 'stopped') {
      const trafficState = buildTrafficState(dbUser, traffic[u.name] || null);
      const periodTotalBytes = trafficState.current.rxBytes + trafficState.current.txBytes;
      if (periodTotalBytes >= dbUser.traffic_limit_gb * 1073741824) {
          console.log(`⚠️ Traffic limit: ${u.name}@${node.id} (${(periodTotalBytes/1073741824).toFixed(2)}/${dbUser.traffic_limit_gb}GB)`);
          try {
            persistTrafficCarry(node.id, u.name, traffic[u.name] || null);
            await ssh.stopRemoteUser(node, u.name);
            db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', node.id, u.name);
            console.log(`🛑 Stopped ${u.name}: traffic limit`);
          } catch (e) { console.error(`Stop failed (traffic limit) ${u.name}:`, e.message); }
      }
    }
  }

  // Auto traffic reset
  const usersToReset = db.prepare(`
    SELECT * FROM users WHERE node_id=? AND traffic_reset_interval IS NOT NULL
    AND traffic_reset_interval != 'never' AND next_reset_at IS NOT NULL
    AND next_reset_at <= datetime('now')
  `).all(node.id);

  for (const u of usersToReset) {
    try {
      flushCurrentTrafficToLifetime(node.id, u.name, traffic[u.name] || null);
      await ssh.stopRemoteUser(node, u.name);
      await ssh.startRemoteUser(node, u.name);
      const next = calcNextReset(u.traffic_reset_interval);
      db.prepare(`UPDATE users SET traffic_reset_at=datetime('now'), traffic_rx_snap=NULL,
        traffic_tx_snap=NULL, traffic_carry_rx_bytes=0, traffic_carry_tx_bytes=0,
        next_reset_at=?, status='active' WHERE id=?`).run(next, u.id);
      console.log(`♻️ Traffic reset ${u.name}@${node.id}, next: ${next}`);
    } catch (e) { console.error(`Traffic reset failed ${u.name}:`, e.message); }
  }
}

async function recordHistory() {
  const nodes = db.prepare('SELECT * FROM nodes').all();
  // Process all nodes in parallel
  const results = await Promise.allSettled(nodes.map(n => processNode(n)));
  results.forEach((r, i) => {
    if (r.status === 'rejected')
      console.error(`recordHistory error on node ${nodes[i].id}:`, r.reason?.message);
  });
  db.prepare("DELETE FROM connections_history WHERE recorded_at < datetime('now', '-24 hours')").run();
}

// Stop expired users — never delete automatically, only an admin can delete a user
async function stopExpiredUsers() {
  // NOTE: do NOT use JOIN — n.* columns overwrite u.* columns
  const expired = db.prepare(
    "SELECT * FROM users WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND status != 'stopped'"
  ).all();
  if (!expired.length) return;
  await Promise.allSettled(expired.map(async u => {
    const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(u.node_id);
    if (!node) return; // orphan user — leave it, admin will clean up
    try {
      persistTrafficCarry(u.node_id, u.name, nodeCache.get(node.id).remoteUsers.find(r => r.name === u.name)?.traffic || null);
      await ssh.stopRemoteUser(node, u.name);
      db.prepare("UPDATE users SET status='stopped' WHERE id=?").run(u.id);
      console.log(`🛑 Auto-stopped expired user: ${u.name}@${u.node_id}`);
    } catch (e) { console.error(`Failed to stop expired user ${u.name}:`, e.message); }
  }));
}

setInterval(recordHistory,    5  * 60 * 1000);
setInterval(stopExpiredUsers, 60  * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🔒 MTG Panel running on http://0.0.0.0:${PORT}`);
  console.log(`🔑 Auth token: ${AUTH_TOKEN}`);
  console.log(`📦 Version: ${pkgVersion}`);
  setTimeout(recordHistory,    10000);
  setTimeout(stopExpiredUsers,  5000);
});
