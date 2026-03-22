import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl, expiryBadge, copyText } from '../utils.jsx';
import { useAppCtx } from '../AppContext.jsx';
import * as I from '../icons.jsx';

export default function AllUsers({ nodes, onSelectNode }) {
  const { t } = useAppCtx();
  const [groups, setGroups]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await Promise.all(nodes.map(async n => {
        try { const users = await api('GET', `/api/nodes/${n.id}/users`); return [n.id, users]; }
        catch { return [n.id, []]; }
      }));
      setGroups(Object.fromEntries(res));
    } finally { setLoading(false); setRefreshing(false); }
  }, [nodes]);

  useEffect(() => { load(); }, [load]);

  const totalUsers  = Object.values(groups).reduce((a, u) => a + u.length, 0);
  const totalOnline = Object.values(groups).reduce((a, u) => a + u.filter(x => x.is_online).length, 0);
  const totalActive = Object.values(groups).reduce((a, u) => a + u.filter(x => x.running).length, 0);

  const copyLink = async (txt) => {
    try { await copyText(txt); toast(t.copied, 'success'); }
    catch { toast(t.copyError, 'error'); }
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
                        {users.map(u => (
                          <tr key={u.id} style={{opacity: u.expired ? 0.55 : 1}}>
                            <td><span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:13}}>{u.name}</span></td>
                            <td><span className="badge badge-purple">{u.port}</span></td>
                            <td>
                              {u.is_online
                                ? <span className="badge badge-green"><span className="dot dot-live"/>{u.connections} {t.online}</span>
                                : <span style={{color:'var(--t3)',fontSize:12}}>{t.offline}</span>}
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
                                <button className="btn btn-icon btn-secondary btn-sm" onClick={() => copyLink(u.link)} title={t.copyLinkTitle}><I.Copy/></button>
                              </div>
                            </td>
                          </tr>
                        ))}
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
    </div>
  );
}
