const { Client } = require('ssh2');
const http = require('http');

const AGENT_TOKEN = process.env.AGENT_TOKEN || 'mtg-agent-secret';

// Shell-quote a single argument (single-quote wrapping with internal ' escaped)
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

// ── Agent HTTP client ──────────────────────────────────────
function agentRequest(host, port, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: host,
      port: parseInt(port),
      path,
      method,
      headers: {
        'x-agent-token': AGENT_TOKEN,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error('Invalid JSON from agent')); }
      });
    });
    req.setTimeout(4000, () => { req.destroy(); reject(new Error('Agent timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function agentGet(node, path) {
  const r = await agentRequest(node.host, node.agent_port, path, 'GET');
  if (r.status >= 400) throw new Error(r.body?.detail || `Agent error ${r.status}`);
  return r.body;
}

async function agentPost(node, path, body = null) {
  const r = await agentRequest(node.host, node.agent_port, path, 'POST', body);
  if (r.status >= 400) throw new Error(r.body?.detail || `Agent error ${r.status}`);
  return r.body;
}

async function agentDelete(node, path) {
  const r = await agentRequest(node.host, node.agent_port, path, 'DELETE');
  if (r.status >= 400) throw new Error(r.body?.detail || `Agent error ${r.status}`);
  return r.body;
}

async function checkAgentHealth(node) {
  if (!node.agent_port) return false;
  try {
    const data = await agentGet(node, '/health');
    return data.status === 'ok';
  } catch {
    return false;
  }
}

// ── SSH exec ───────────────────────────────────────────────
function sshExec(node, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';
    let errOutput = '';

    const config = {
      host: node.host,
      port: node.ssh_port || 22,
      username: node.ssh_user || 'root',
      readyTimeout: 3000,
    };

    if (node.ssh_key)      config.privateKey = node.ssh_key;
    else if (node.ssh_password) config.password = node.ssh_password;

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('data', d => { output += d.toString(); });
        stream.stderr.on('data', d => { errOutput += d.toString(); });
        stream.on('close', () => { conn.end(); resolve({ output: output.trim(), error: errOutput.trim() }); });
      });
    });
    conn.on('error', err => reject(err));
    conn.connect(config);
  });
}

async function checkNode(node) {
  if (node.agent_port) {
    const ok = await checkAgentHealth(node);
    if (ok) return true;
  }
  try {
    const r = await sshExec(node, 'echo ok');
    return r.output === 'ok';
  } catch {
    return false;
  }
}

async function getNodeStatus(node) {
  // Agent-first: fast HTTP call (data comes from agent cache — < 10ms)
  if (node.agent_port) {
    try {
      const data = await agentGet(node, '/metrics');
      const containers = data.containers || [];
      const running     = containers.filter(c => c.running).length;
      const online_users = containers.filter(c => (c.connections || 0) > 0).length;
      return { online: true, containers: running, online_users, via_agent: true };
    } catch {}
  }
  // SSH fallback (slow — only when no agent)
  try {
    const r = await sshExec(node, "COUNT=$(docker ps --filter 'name=mtg-' --format '{{.Names}}' 2>/dev/null | grep -v mtg-agent | wc -l); echo \"ONLINE|$COUNT\"");
    if (r.output.startsWith('ONLINE|')) {
      const count = parseInt(r.output.split('|')[1]) || 0;
      return { online: true, containers: count, online_users: 0 };
    }
    return { online: false, containers: 0, online_users: 0 };
  } catch {
    return { online: false, containers: 0, online_users: 0 };
  }
}

async function getRemoteUsers(node) {
  // Agent v2: returns port+secret from config files
  if (node.agent_port) {
    try {
      const users = await agentGet(node, '/users');
      // Only trust agent result if it actually returned users.
      // Empty array means agent's BASE_DIR doesn't match the real user directory
      // (agent can't see users there) — fall through to SSH which reads the real path.
      if (Array.isArray(users) && users.length > 0) {
        return users.map(u => ({
          name:        u.name,
          port:        u.port,
          secret:      u.secret,
          status:      u.running ? 'Up' : 'stopped',
          running:     u.running || false,
          connections: u.connections || 0,
          traffic:     u.traffic   || null,
          via_agent:   true,
        }));
      }
    } catch {}
  }
  // SSH fallback
  try {
    const cmd = [
      'BASE=' + node.base_dir,
      'for DIR in $BASE/*/; do',
      '  [ -d "$DIR" ] || continue',
      '  NAME=$(basename "$DIR")',
      "  SECRET=$(grep secret \"$DIR/config.toml\" 2>/dev/null | awk -F'\"' '{print $2}')",
      "  PORT=$(grep -o '[0-9]*:3128' \"$DIR/docker-compose.yml\" 2>/dev/null | cut -d: -f1)",
      "  STATUS=$(docker ps --filter \"name=mtg-$NAME\" --format '{{.Status}}' 2>/dev/null)",
      "  PID=$(docker inspect --format '{{.State.Pid}}' \"mtg-$NAME\" 2>/dev/null)",
      "  CONNS=0",
      "  if [ -n \"$PID\" ] && [ \"$PID\" != \"0\" ]; then",
      "    CONNS=$(awk 'NR>1 && $4==\"01\" && substr($2,index($2,\":\")+1)==\"0C38\"{split($3,a,\":\");ips[a[1]]=1} END{print length(ips)+0}' /proc/$PID/net/tcp6 2>/dev/null || awk 'NR>1 && $4==\"01\" && substr($2,index($2,\":\")+1)==\"0C38\"{split($3,a,\":\");ips[a[1]]=1} END{print length(ips)+0}' /proc/$PID/net/tcp 2>/dev/null || echo 0)",
      "  fi",
      '  echo "USER|$NAME|$PORT|$SECRET|${STATUS:-stopped}|$CONNS"',
      'done'
    ].join('\n');
    const r = await sshExec(node, cmd);
    const users = [];
    for (const line of r.output.split('\n')) {
      if (!line.startsWith('USER|')) continue;
      const [, name, port, secret, status, conns] = line.split('|');
      if (!name) continue;
      users.push({ name, port: parseInt(port), secret, status, connections: parseInt(conns) || 0 });
    }
    return users;
  } catch {
    return [];
  }
}

async function getTraffic(node) {
  // Agent-first
  if (node.agent_port) {
    try {
      const users = await agentGet(node, '/users');
      if (Array.isArray(users)) {
        const result = {};
        for (const u of users) {
          result[u.name] = { rx: u.traffic?.rx || '0B', tx: u.traffic?.tx || '0B' };
        }
        return result;
      }
    } catch {}
  }
  // SSH fallback: docker stats is too slow (~2s per container), skip it
  return {};
}

async function createRemoteUser(node, name) {
  // Agent-first: create via HTTP (fast, no SSH)
  if (node.agent_port) {
    try {
      const r = await agentPost(node, '/users', { name });
      // Validate agent response — port and secret must be present
      if (r && r.port && r.secret) {
        return { port: r.port, secret: r.secret };
      }
      // Agent returned success but with missing/null port or secret
      // This can happen if agent's BASE_DIR is wrong — fall through to SSH
    } catch (e) {
      // Agent says user already exists on remote but NOT in DB (partial failure from
      // a previous attempt). Recover by reading the user's port+secret from agent cache.
      if (e.message && e.message.includes('already exists')) {
        try {
          const users = await agentGet(node, '/users');
          const existing = Array.isArray(users) && users.find(u => u.name === name);
          if (existing && existing.port && existing.secret) {
            return { port: existing.port, secret: existing.secret };
          }
        } catch {}
        // Can't recover port+secret from agent — fall through to SSH to read config files
      }
      // Invalid name format — always rethrow
      if (e.message && e.message.includes('Invalid name')) {
        throw e;
      }
      // If no SSH credentials configured, can't fall back — throw agent error directly
      if (!node.ssh_key && !node.ssh_password) {
        throw new Error(`Агент недоступен и SSH не настроен: ${e.message}`);
      }
      // Network errors, JSON issues, timeouts → fall through to SSH fallback
    }
  }
  // SSH fallback
  const baseDir = node.base_dir;
  const startPort = node.start_port || 4433;
  const cmd = [
    'BASE=' + shq(baseDir), 'NAME=' + shq(name), 'START_PORT=' + parseInt(startPort, 10),
    'USER_DIR="$BASE/$NAME"',
    'if [ -d "$USER_DIR" ]; then echo EXISTS; exit 1; fi',
    'MAX_PORT=$(grep -r "[0-9]*:3128" "$BASE" 2>/dev/null | grep -oE "[0-9]+:3128" | cut -d: -f1 | sort -n | tail -1)',
    '[ -z "$MAX_PORT" ] && PORT=$START_PORT || PORT=$((MAX_PORT + 1))',
    "SECRET=\"ee$(openssl rand -hex 16)$(echo -n 'google.com' | xxd -p)\"",
    'mkdir -p "$USER_DIR"',
    'printf \'secret = "%s"\nbind-to = "0.0.0.0:3128"\n\' "$SECRET" > "$USER_DIR/config.toml"',
    'printf \'services:\n  mtg-%s:\n    image: nineseconds/mtg:2\n    container_name: mtg-%s\n    restart: unless-stopped\n    ports:\n      - "%s:3128"\n    volumes:\n      - %s/config.toml:/config.toml:ro\n    command: run /config.toml\n\' "$NAME" "$NAME" "$PORT" "$USER_DIR" > "$USER_DIR/docker-compose.yml"',
    'cd "$USER_DIR" && docker compose up -d 2>&1',
    'echo "OK|$NAME|$PORT|$SECRET"'
  ].join('\n');
  const r = await sshExec(node, cmd);
  if (r.output.includes('EXISTS')) {
    // Remote dir exists but user not in DB — read existing config files to recover port+secret
    const recoverCmd = [
      'BASE=' + shq(baseDir), 'NAME=' + shq(name), 'USER_DIR="$BASE/$NAME"',
      "SECRET=$(grep secret \"$USER_DIR/config.toml\" 2>/dev/null | awk -F'\"' '{print $2}')",
      "PORT=$(grep -o '[0-9]*:3128' \"$USER_DIR/docker-compose.yml\" 2>/dev/null | cut -d: -f1)",
      'echo "RECOVER|$PORT|$SECRET"'
    ].join('\n');
    const rec = await sshExec(node, recoverCmd);
    const recLine = rec.output.split('\n').find(l => l.startsWith('RECOVER|'));
    if (recLine) {
      const [, rPort, rSecret] = recLine.split('|');
      if (rPort && rSecret) return { port: parseInt(rPort), secret: rSecret };
    }
    throw new Error('User already exists on node');
  }
  const okLine = r.output.split('\n').find(l => l.startsWith('OK|'));
  if (!okLine) throw new Error('Failed to create user: ' + r.output);
  const parts = okLine.split('|');
  return { port: parseInt(parts[2]), secret: parts[3] };
}

async function removeRemoteUser(node, name) {
  if (node.agent_port) {
    try {
      await agentDelete(node, `/users/${name}`);
      return;
    } catch (_) {
      // Any agent error (not found, invalid JSON, timeout, etc.) — fall through to SSH
    }
  }
  // SSH fallback
  const cmd = [
    'BASE=' + shq(node.base_dir), 'NAME=' + shq(name), 'USER_DIR="$BASE/$NAME"',
    'if [ -d "$USER_DIR" ]; then cd "$USER_DIR" && docker compose down 2>/dev/null; rm -rf "$USER_DIR"; fi',
    'echo DONE'
  ].join('\n');
  await sshExec(node, cmd);
  // Tell agent to evict this user from its cache (directory is already gone, agent returns OK)
  if (node.agent_port) {
    agentDelete(node, `/users/${name}`).catch(() => {});
  }
}

async function stopRemoteUser(node, name) {
  if (node.agent_port) {
    try {
      await agentPost(node, `/users/${name}/stop`);
      return;
    } catch (_) {
      // Agent failed or doesn't know this user — always fall through to SSH
    }
  }
  await sshExec(node, 'cd ' + shq(node.base_dir + '/' + name) + ' && docker compose stop 2>/dev/null');
}

async function startRemoteUser(node, name) {
  if (node.agent_port) {
    try {
      await agentPost(node, `/users/${name}/start`);
      return;
    } catch (_) {
      // Agent failed or doesn't know this user — always fall through to SSH
    }
  }
  await sshExec(node, 'cd ' + shq(node.base_dir + '/' + name) + ' && docker compose up -d 2>/dev/null');
}

async function restartRemoteUser(node, name) {
  if (node.agent_port) {
    try {
      await agentPost(node, `/users/${name}/restart`);
      return;
    } catch (_) {
      // Agent failed or doesn't know this user — always fall through to SSH
    }
  }
  await sshExec(node, 'cd ' + shq(node.base_dir + '/' + name) + ' && docker compose stop 2>/dev/null; docker compose up -d 2>/dev/null');
}

module.exports = {
  sshExec, checkNode, checkAgentHealth,
  agentGetPublic: agentGet,
  getNodeStatus, getRemoteUsers, getTraffic,
  createRemoteUser, removeRemoteUser, stopRemoteUser, startRemoteUser, restartRemoteUser,
};
