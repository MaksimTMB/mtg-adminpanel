/**
 * Server-side node cache.
 *
 * Polls every node (agent or SSH) in the background every REFRESH_INTERVAL ms.
 * All API endpoints read from this cache and respond in < 5 ms — no request
 * ever waits for an SSH connection or HTTP call to an agent.
 *
 * Entry shape:
 *   {
 *     status:      { online, containers, online_users },
 *     remoteUsers: [ { name, port, secret, status, running, connections, traffic } ],
 *     agentVersion: string | null,
 *     updatedAt:   number  (Date.now()),
 *     error:       string | null,
 *   }
 */

const ssh = require('./ssh');

const REFRESH_INTERVAL = 10_000; // ms between full refreshes
const cache = new Map();         // nodeId (number) → entry
let _db = null;
let _timer = null;

// ── Public API ────────────────────────────────────────────

/** Start background polling. Call once after DB is ready. */
function start(db) {
  _db = db;
  _refreshAll();                          // immediate first pass
  _timer = setInterval(_refreshAll, REFRESH_INTERVAL);
}

/** Get cached entry for a node. Never null — returns safe defaults. */
function get(nodeId) {
  return cache.get(Number(nodeId)) || _empty();
}

/** Force an immediate refresh for a single node (call after mutations). */
async function refresh(node) {
  await _refreshNode(node);
}

/** Invalidate cache entry (e.g. after node deleted). */
function invalidate(nodeId) {
  cache.delete(Number(nodeId));
}

// ── Internals ─────────────────────────────────────────────

function _empty() {
  return { status: { online: false, containers: 0, online_users: 0 }, remoteUsers: [], agentVersion: null, updatedAt: 0, error: null };
}

async function _refreshNode(node) {
  try {
    const [statusResult, usersResult, healthResult] = await Promise.allSettled([
      ssh.getNodeStatus(node),
      ssh.getRemoteUsers(node),
      node.agent_port ? ssh.agentGetPublic(node, '/health').catch(() => null) : Promise.resolve(null),
    ]);

    if (statusResult.status === 'rejected')
      console.error(`[nodeCache] ${node.name} status error:`, statusResult.reason?.message);
    if (usersResult.status === 'rejected')
      console.error(`[nodeCache] ${node.name} users error:`, usersResult.reason?.message);

    const remoteUsers = usersResult.status === 'fulfilled' ? usersResult.value : null;
    if (remoteUsers) {
      const running = remoteUsers.filter(u => u.running).length;
      console.log(`[nodeCache] ${node.name}: ${remoteUsers.length} users, ${running} running, via_agent=${remoteUsers[0]?.via_agent||false}`);
    }

    const prev = cache.get(node.id) || _empty();
    cache.set(node.id, {
      status:       statusResult.status  === 'fulfilled' ? statusResult.value  : prev.status,
      remoteUsers:  usersResult.status   === 'fulfilled' ? usersResult.value   : prev.remoteUsers,
      agentVersion: healthResult.status  === 'fulfilled' && healthResult.value
                      ? (healthResult.value.version || null)
                      : prev.agentVersion,
      updatedAt: Date.now(),
      error: statusResult.status === 'rejected' ? String(statusResult.reason) : null,
    });
  } catch (e) {
    console.error(`[nodeCache] ${node.name} refresh crashed:`, e.message);
    const prev = cache.get(node.id);
    if (prev) cache.set(node.id, { ...prev, error: String(e), updatedAt: Date.now() });
  }
}

async function _refreshAll() {
  if (!_db) return;
  try {
    const nodes = _db.prepare('SELECT * FROM nodes').all();
    // Refresh all nodes in parallel
    await Promise.allSettled(nodes.map(_refreshNode));
  } catch (e) {
    console.error('[nodeCache] refresh error:', e.message);
  }
}

module.exports = { start, get, refresh, invalidate };
