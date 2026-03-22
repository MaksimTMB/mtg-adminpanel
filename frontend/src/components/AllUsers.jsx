import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl, expiryBadge, copyText } from '../utils.jsx';
import { useAppCtx } from '../AppContext.jsx';
import EditModal from './EditModal.jsx';
import QRModal from './QRModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import * as I from '../icons.jsx';

function Sparkline({ data, color = 'var(--cy)', width = 72, height = 24 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = data[data.length - 1];
  const lx = width;
  const ly = height - (last / max) * (height - 2) - 1;
  return (
    <svg width={width} height={height} style={{display:'block',overflow:'visible'}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
      {last > 0 && <circle cx={lx} cy={ly} r="2.5" fill={color}/>}
    </svg>
  );
}

export default function AllUsers({ nodes, onSelectNode }) {
  const { t } = useAppCtx();
  const [groups, setGroups]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy]             = useState({});
  const [history, setHistory]       = useState({});
  const [editU, setEditU]           = useState(null);   // { user, nodeId }
  const [qrU, setQrU]               = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);   // { user, nodeId }

  const loadHistory = useCallback(async (nodeId, userList) => {
    await Promise.allSettled(userList.map(async u => {
      try {
        const rows = await api('GET', `/api/nodes/${nodeId}/users/${u.name}/history`);
        setHistory(h => ({...h, [`${nodeId}_${u.name}`]: rows.map(r => r.connections)}));
      } catch {}
    }));
  }, []);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await Promise.all(nodes.map(async n => {
        try { const users = await api('GET', `/api/nodes/${n.id}/users`); return [n.id, users]; }
        catch { return [n.id, []]; }
      }));
      const map = Object.fromEntries(res);
      setGroups(map);
      nodes.forEach(n => { if (map[n.id]?.length) loadHistory(n.id, map[n.id]); });
    } finally { setLoading(false); setRefreshing(false); }
  }, [nodes, loadHistory]);

  useEffect(() => { load(); }, [load]);

  const totalUsers  = Object.values(groups).reduce((a, u) => a + u.length, 0);
  const totalOnline = Object.values(groups).reduce((a, u) => a + u.filter(x => x.is_online).length, 0);
  const totalActive = Object.values(groups).reduce((a, u) => a + u.filter(x => x.running).length, 0);

  const copyLink = async (txt) => {
    try { await copyText(txt); toast(t.copied, 'success'); }
    catch { toast(t.copyError, 'error'); }
  };

  const busyKey = (nodeId, name) => `${nodeId}_${name}`;
  const setBusyFor = (nodeId, name, v) => setBusy(b => ({...b, [busyKey(nodeId, name)]: v}));

  const toggle = async (nodeId, user) => {
    const action = user.running ? 'stop' : 'start';
    if (action === 'start' && user.expired) {
      if (!confirm(t.expiredWarning(user.name))) return;
    }
    setGroups(g => ({...g, [nodeId]: g[nodeId].map(u => u.name === user.name ? {...u, running: !user.running} : u)}));
    setBusyFor(nodeId, user.name, true);
    try {
      await api('POST', `/api/nodes/${nodeId}/users/${user.name}/${action}`);
      toast(action === 'stop' ? t.userStopped(user.name) : t.userStarted(user.name), 'success');
    } catch(e) {
      setGroups(g => ({...g, [nodeId]: g[nodeId].map(u => u.name === user.name ? {...u, running: user.running} : u)}));
      toast(e.message, 'error');
    }
    finally { setBusyFor(nodeId, user.name, false); }
  };

  const resetTraffic = async (nodeId, user) => {
    if (!confirm(`${t.resetTrafficTitle}\n${user.name}?`)) return;
    setBusyFor(nodeId, user.name + '_reset', true);
    try {
      await api('POST', `/api/nodes/${nodeId}/users/${user.name}/reset-traffic`);
      toast(t.trafficReset(user.name), 'success');
      load(true);
    } catch(e) { toast(e.message, 'error'); }
    finally { setBusyFor(nodeId, user.name + '_reset', false); }
  };

  const remove = async ({ user, nodeId }) => {
    setBusyFor(nodeId, user.name, true);
    try {
      await api('DELETE', `/api/nodes/${nodeId}/users/${user.name}`);
      toast(t.userDeleted(user.name), 'success');
      load(true);
    } catch(e) { toast(e.message, 'error'); }
    finally { setBusyFor(nodeId, user.name, false); }
  };

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title">{t.allTitle} <em>{t.allTitleEm}</em></div>
          <div className="page-desc">
            {loading ? '...' : t.allUsersStats(totalUsers, totalActive, totalOnline, nodes.length)}
          </div>
        </div>
        <div className="topbar-right">
          {refreshing && <span className="refreshing"><span className="spin"/></span>}
          <button className="btn btn-ghost btn-sm" onClick={() => load(true)}><I.RefreshCw/> {t.refresh}</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spin"/> {t.loading}</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {nodes.map(node => {
            const users  = groups[node.id] || [];
            const active = users.filter(u => u.running).length;
            const online = users.filter(u => u.is_online).length;
            return (
              <div className="card" key={node.id}>
                <div className="all-users-node-head" style={{marginBottom: users.length ? 16 : 0}}>
                  <div className="all-users-node-meta">
                    {node.flag
                      ? <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:30,height:22,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)',flexShrink:0}}/>
                      : <div className="node-icon" style={{width:30,height:30,borderRadius:7}}><I.Server/></div>}
                    <div className="all-users-node-meta-text">
                      <div style={{fontWeight:600,fontSize:14}}>{node.name}</div>
                      <div style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)'}}>{node.host}</div>
                      {users.length > 0 && (
                        <div className="all-users-node-badges">
                          {online > 0 && <span className="badge badge-green"><span className="dot dot-live"/>{online} {t.online}</span>}
                          <span className="badge badge-purple">{active} / {users.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="all-users-node-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => onSelectNode(node)}>
                      <I.Users/> {t.manage}
                    </button>
                  </div>
                </div>

                {users.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead><tr>
                        <th>{t.colClient}</th>
                        <th>{t.colPort}</th>
                        <th>{t.colConnections}</th>
                        <th>{t.colTraffic}</th>
                        <th>{t.colTotal}</th>
                        <th>{t.colStatus}</th>
                        <th>{t.colExpiry}</th>
                        <th>{t.colNote}</th>
                        <th></th>
                      </tr></thead>
                      <tbody>
                        {users.map(u => {
                          const bk   = busyKey(node.id, u.name);
                          const bkR  = busyKey(node.id, u.name + '_reset');
                          const hist = history[`${node.id}_${u.name}`];
                          return (
                            <tr key={u.id} style={{opacity: u.expired ? 0.55 : 1}}>
                              <td><span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:13}}>{u.name}</span></td>
                              <td><span className="badge badge-purple">{u.port}</span></td>
                              <td>
                                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                                  {u.is_online
                                    ? <span className="badge badge-green"><span className="dot dot-live"/>{u.connections} {t.online}</span>
                                    : <span style={{color:'var(--t3)',fontSize:12}}>{t.offline}</span>}
                                  {hist && hist.length > 1 && (
                                    <Sparkline data={hist} color={u.is_online ? 'var(--gr)' : 'var(--t3)'}/>
                                  )}
                                </div>
                              </td>
                              <td>
                                {(u.current_traffic_rx_bytes > 0 || u.current_traffic_tx_bytes > 0)
                                  ? <span className="traf">
                                      <span className="rx">↓{u.current_traffic_rx}</span>
                                      <span className="tx"> ↑{u.current_traffic_tx}</span>
                                      {!u.running && <span style={{fontSize:10,color:'var(--t3)',marginLeft:3}}>⏸</span>}
                                    </span>
                                  : <span style={{color:'var(--t3)',fontSize:11}}>—</span>}
                              </td>
                              <td>
                                {(u.lifetime_traffic_rx_bytes > 0 || u.lifetime_traffic_tx_bytes > 0)
                                  ? <span className="traf">
                                      <span className="rx">↓{u.lifetime_traffic_rx}</span>
                                      <span className="tx"> ↑{u.lifetime_traffic_tx}</span>
                                    </span>
                                  : <span style={{color:'var(--t3)',fontSize:11}}>—</span>}
                              </td>
                              <td>
                                <span className={`badge ${u.running ? 'badge-green' : 'badge-red'}`}>
                                  <span className={`dot ${u.running ? 'dot-live' : ''}`}/>
                                  {u.running ? t.running : t.stop}
                                </span>
                              </td>
                              <td>{expiryBadge(u.expires_at, true)}</td>
                              <td style={{maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:12,color:'var(--t2)'}} title={u.note}>
                                {u.note || <span style={{color:'var(--t3)'}}>—</span>}
                              </td>
                              <td>
                                <div className="acts">
                                  <button className={`btn btn-icon btn-sm ${u.running ? 'btn-ghost' : 'btn-primary'}`}
                                    onClick={() => toggle(node.id, u)} disabled={busy[bk]}
                                    title={u.running ? t.stopTitle : t.startTitle}>
                                    {busy[bk] ? <span className="spin spin-sm"/> : (u.running ? <I.Pause/> : <I.Play/>)}
                                  </button>
                                  <button className="btn btn-icon btn-secondary btn-sm" onClick={() => copyLink(u.link)} title={t.copyLinkTitle}><I.Copy/></button>
                                  <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setQrU(u)} title="QR"><I.QrCode/></button>
                                  <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setEditU({ user: u, nodeId: node.id })} title={t.edit}><I.Edit/></button>
                                  <button className="btn btn-icon btn-secondary btn-sm" onClick={() => resetTraffic(node.id, u)}
                                    disabled={busy[bkR]} title={t.resetTrafficTitle}>
                                    {busy[bkR] ? <span className="spin spin-sm"/> : <I.RefreshCw/>}
                                  </button>
                                  <button className="btn btn-icon btn-danger btn-sm" onClick={() => setConfirmDel({ user: u, nodeId: node.id })}
                                    disabled={busy[bk]} title={t.delete}><I.Trash/></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {users.length === 0 && (
                  <div style={{color:'var(--t3)',fontSize:12,textAlign:'center',padding:'12px 0'}}>
                    {t.noClientsOnNode}
                  </div>
                )}
              </div>
            );
          })}
          {!nodes.length && (
            <div className="empty"><div className="empty-icon"><I.Users/></div><div className="empty-title">{t.noNodesTitle}</div></div>
          )}
        </div>
      )}

      {qrU && <QRModal user={qrU} onClose={() => setQrU(null)}/>}
      {editU && (
        <EditModal
          user={editU.user}
          nodeId={editU.nodeId}
          onClose={() => setEditU(null)}
          onSave={() => { setEditU(null); load(true); }}
        />
      )}
      {confirmDel && (
        <ConfirmModal
          title={t.deleteClientTitle}
          message={<>{t.deleteClientMsgPre} <strong>{confirmDel.user.name}</strong> {t.deleteClientMsgPost}</>}
          confirmText={t.deleteClientBtn}
          onConfirm={() => remove(confirmDel)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
