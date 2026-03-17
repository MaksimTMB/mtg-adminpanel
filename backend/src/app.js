require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');
const ssh     = require('./ssh');
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
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (_) {}
  }
}
runMigrations();

// ── App ───────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Public endpoints (no auth) ────────────────────────────
app.get('/api/version', (req, res) => {
  res.json({ version: pkgVersion });
});

// ── Auth middleware ───────────────────────────────────────
app.use('/api', (req, res, next) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// ── TOTP 2FA ──────────────────────────────────────────────
const TOTP_ISSUER = 'MTG Panel';

function getTotpSecret() {
  const row = db.prepare("SELECT value FROM settings WHERE key='totp_secret'").get();
  return row ? row.value : null;
}
function isTotpEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key='totp_enabled'").get();
  return row && row.value === '1';
}

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
    res.json({ ok: true });
  } else { res.status(400).json({ error: 'Invalid code' }); }
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
  res.json({ ok: true });
});

// ── Nodes ─────────────────────────────────────────────────
app.get('/api/nodes', (req, res) => {
  res.json(db.prepare('SELECT id, name, host, ssh_user, ssh_port, base_dir, start_port, created_at, flag, agent_port FROM nodes').all());
});

app.post('/api/nodes', (req, res) => {
  const { name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port } = req.body;
  if (!name || !host) return res.status(400).json({ error: 'name и host обязательны' });
  const result = db.prepare(
    'INSERT INTO nodes (name, host, ssh_user, ssh_port, ssh_key, ssh_password, base_dir, start_port, flag, agent_port) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, host, ssh_user||'root', ssh_port||22, ssh_key||null, ssh_password||null, base_dir||'/opt/mtg/users', start_port||4433, flag||null, agent_port||null);
  res.json({ id: result.lastInsertRowid, name, host });
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
  // Use wget (more universally available than curl), write to temp file
  const RAW = 'https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/dev/mtg-agent';
  const cmd = [
    `mkdir -p /opt/mtg-agent && cd /opt/mtg-agent`,
    `wget -q "${RAW}/main.py" -O main.py`,
    `wget -q "${RAW}/docker-compose.yml" -O docker-compose.yml`,
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

app.get('/api/status', async (req, res) => {
  const nodes = db.prepare('SELECT * FROM nodes').all();
  const results = await Promise.allSettled(
    nodes.map(async node => {
      const status = await ssh.getNodeStatus(node);
      // online_users only via agent (fast) — skip SSH nodes to avoid slowdown
      let online_users = 0;
      if (node.agent_port) {
        try {
          const remoteUsers = await ssh.getRemoteUsers(node);
          online_users = remoteUsers.filter(u => (u.connections || 0) > 0).length;
        } catch (_) {}
      }
      return { id: node.id, name: node.name, host: node.host, ...status, online_users };
    })
  );
  res.json(results.map((r, i) => r.status === 'fulfilled'
    ? r.value
    : { id: nodes[i].id, name: nodes[i].name, online: false, online_users: 0 }
  ));
});

// ── Users ─────────────────────────────────────────────────
app.get('/api/nodes/:id/users', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Not found' });
  const dbUsers = db.prepare('SELECT * FROM users WHERE node_id = ?').all(req.params.id);

  const mkUser = (u, remote) => ({
    ...u,
    connections: remote ? remote.connections : 0,
    running: remote ? !remote.status.includes('stopped') : false,
    is_online: remote ? (remote.connections || 0) > 0 : false,
    link: `tg://proxy?server=${node.host}&port=${u.port}&secret=${u.secret}`,
    expired: u.expires_at ? new Date(u.expires_at) < new Date() : false,
  });

  try {
    const remoteUsers = await ssh.getRemoteUsers(node);

    // Real-time device limit enforcement
    for (const remote of remoteUsers) {
      const dbUser = dbUsers.find(u => u.name === remote.name);
      if (dbUser && dbUser.max_devices && (remote.connections || 0) > dbUser.max_devices) {
        console.log(`⚠️ Device limit exceeded: ${remote.name} (${remote.connections}/${dbUser.max_devices}) — stopping`);
        ssh.stopRemoteUser(node, remote.name).catch(() => {});
        db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', req.params.id, remote.name);
        remote.status = 'stopped';
        remote.connections = 0;
      }
      if ((remote.connections || 0) > 0) {
        db.prepare("UPDATE users SET last_seen_at=datetime('now') WHERE node_id=? AND name=?")
          .run(req.params.id, remote.name);
      }
    }

    res.json(dbUsers.map(u => mkUser(u, remoteUsers.find(r => r.name === u.name))));
  } catch (_) {
    res.json(dbUsers.map(u => mkUser(u, null)));
  }
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
  if (db.prepare('SELECT id FROM users WHERE node_id = ? AND name = ?').get(req.params.id, name)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  try {
    const { port, secret } = await ssh.createRemoteUser(node, name);
    const result = db.prepare(
      'INSERT INTO users (node_id, name, port, secret, note, expires_at, traffic_limit_gb) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, name, port, secret, note||'', expires_at||null, traffic_limit_gb||null);
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
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stop: save traffic snapshot before stopping so UI keeps last known value
app.post('/api/nodes/:id/users/:name/stop', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    // Save traffic snapshot before stopping
    try {
      const traffic = await ssh.getTraffic(node);
      const ut = traffic[req.params.name];
      if (ut) {
        db.prepare('UPDATE users SET traffic_rx_snap=?, traffic_tx_snap=? WHERE node_id=? AND name=?')
          .run(ut.rx, ut.tx, req.params.id, req.params.name);
      }
    } catch (_) {}
    await ssh.stopRemoteUser(node, req.params.name);
    db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', req.params.id, req.params.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/nodes/:id/users/:name/start', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    await ssh.startRemoteUser(node, req.params.name);
    db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('active', req.params.id, req.params.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset traffic: restart container (clears MTG counter) + record timestamp
app.post('/api/nodes/:id/users/:name/reset-traffic', async (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  try {
    await ssh.stopRemoteUser(node, req.params.name);
    await ssh.startRemoteUser(node, req.params.name);
    db.prepare(`UPDATE users SET
      traffic_reset_at=datetime('now'), traffic_rx_snap=NULL, traffic_tx_snap=NULL,
      status='active' WHERE node_id=? AND name=?`
    ).run(req.params.id, req.params.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nodes/:id/users/:name/history', (req, res) => {
  const rows = db.prepare(
    'SELECT connections, recorded_at FROM connections_history WHERE node_id=? AND user_name=? ORDER BY recorded_at DESC LIMIT 48'
  ).all(req.params.id, req.params.name);
  res.json(rows.reverse());
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

// ── Background jobs ───────────────────────────────────────
async function recordHistory() {
  const nodes = db.prepare('SELECT * FROM nodes').all();
  for (const node of nodes) {
    try {
      const remoteUsers = await ssh.getRemoteUsers(node);
      const traffic = await ssh.getTraffic(node).catch(() => ({}));

      for (const u of remoteUsers) {
        const conns = u.connections || 0;
        db.prepare('INSERT INTO connections_history (node_id, user_name, connections) VALUES (?, ?, ?)')
          .run(node.id, u.name, conns);

        if (conns > 0) {
          db.prepare("UPDATE users SET last_seen_at=datetime('now') WHERE node_id=? AND name=?")
            .run(node.id, u.name);
        }

        // Device limit enforcement
        const dbUser = db.prepare('SELECT * FROM users WHERE node_id=? AND name=?').get(node.id, u.name);
        if (dbUser && dbUser.max_devices && conns > dbUser.max_devices) {
          console.log(`⚠️ Device limit exceeded: ${u.name} on node ${node.id} (${conns}/${dbUser.max_devices})`);
          try {
            await ssh.stopRemoteUser(node, u.name);
            db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', node.id, u.name);
            console.log(`🛑 Auto-stopped ${u.name}: exceeded device limit`);
          } catch (e) { console.error('Failed to stop user:', e.message); }
        }

        // Traffic limit enforcement
        if (dbUser && dbUser.traffic_limit_gb && dbUser.status !== 'stopped') {
          const t = traffic[u.name];
          if (t) {
            const totalBytes = parseBytes(t.rx) + parseBytes(t.tx);
            const limitBytes = dbUser.traffic_limit_gb * 1073741824;
            if (totalBytes >= limitBytes) {
              console.log(`⚠️ Traffic limit exceeded: ${u.name} on node ${node.id} (${(totalBytes/1073741824).toFixed(2)}GB / ${dbUser.traffic_limit_gb}GB)`);
              try {
                await ssh.stopRemoteUser(node, u.name);
                db.prepare('UPDATE users SET status=? WHERE node_id=? AND name=?').run('stopped', node.id, u.name);
                console.log(`🛑 Auto-stopped ${u.name}: exceeded traffic limit`);
              } catch (e) { console.error('Failed to stop user on traffic limit:', e.message); }
            }
          }
        }
      }

      // Auto traffic reset check
      const usersToReset = db.prepare(`
        SELECT * FROM users WHERE node_id=? AND traffic_reset_interval IS NOT NULL
        AND traffic_reset_interval != 'never' AND next_reset_at IS NOT NULL
        AND next_reset_at <= datetime('now')
      `).all(node.id);

      for (const u of usersToReset) {
        try {
          // Accumulate total traffic before reset
          const t = traffic[u.name];
          if (t) {
            const rxBytes = parseBytes(t.rx) + (u.total_traffic_rx_bytes || 0);
            const txBytes = parseBytes(t.tx) + (u.total_traffic_tx_bytes || 0);
            db.prepare('UPDATE users SET total_traffic_rx_bytes=?, total_traffic_tx_bytes=? WHERE id=?')
              .run(rxBytes, txBytes, u.id);
          }
          // Reset traffic (restart container)
          await ssh.stopRemoteUser(node, u.name);
          await ssh.startRemoteUser(node, u.name);
          const next = calcNextReset(u.traffic_reset_interval);
          db.prepare(`UPDATE users SET traffic_reset_at=datetime('now'), traffic_rx_snap=NULL,
            traffic_tx_snap=NULL, next_reset_at=?, status='active' WHERE id=?`).run(next, u.id);
          console.log(`♻️ Auto-reset traffic for ${u.name} on node ${node.id}, next: ${next}`);
        } catch (e) { console.error(`Failed to auto-reset traffic for ${u.name}:`, e.message); }
      }

    } catch (_) {}
  }
  db.prepare("DELETE FROM connections_history WHERE recorded_at < datetime('now', '-24 hours')").run();
}

async function cleanExpiredUsers() {
  // NOTE: do NOT use JOIN here — n.id/n.name/n.created_at overwrite u.id/u.name/u.created_at
  const expired = db.prepare(
    "SELECT * FROM users WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
  ).all();
  for (const u of expired) {
    const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(u.node_id);
    if (!node) { db.prepare('DELETE FROM users WHERE id=?').run(u.id); continue; }
    try {
      await ssh.removeRemoteUser(node, u.name);
      db.prepare('DELETE FROM users WHERE id=?').run(u.id);
      console.log(`🗑️ Auto-deleted expired user: ${u.name} on node ${u.node_id}`);
    } catch (e) { console.error(`Failed to delete expired user ${u.name}:`, e.message); }
  }
}

setInterval(recordHistory,     5  * 60 * 1000);
setInterval(cleanExpiredUsers, 60  * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🔒 MTG Panel running on http://0.0.0.0:${PORT}`);
  console.log(`🔑 Auth token: ${AUTH_TOKEN}`);
  console.log(`📦 Version: ${pkgVersion}`);
  setTimeout(recordHistory,     10000);
  setTimeout(cleanExpiredUsers,  5000);
});
