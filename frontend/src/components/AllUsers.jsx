import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl, expiryBadge } from '../utils.jsx';
import * as I from '../icons.jsx';

const copyText = (txt) => navigator.clipboard.writeText(txt).then(() => toast('Скопировано!', 'success'));

export default function AllUsers({ nodes, onSelectNode }) {
  const [groups, setGroups]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      // /users already contains traffic_rx/tx + connections — no extra call needed
      const res = await Promise.all(nodes.map(async n => {
        try {
          const users = await api('GET', `/api/nodes/${n.id}/users`);
          return [n.id, users.map(u => ({
            ...u,
            // prefer live traffic, fall back to DB snapshot
            traffic: (u.traffic_rx || u.traffic_rx_snap)
              ? { rx: u.traffic_rx || u.traffic_rx_snap, tx: u.traffic_tx || u.traffic_tx_snap, live: !!u.traffic_rx }
              : null,
          }))];
        } catch { return [n.id, []]; }
      }));
      setGroups(Object.fromEntries(res));
    } finally { setLoading(false); setRefreshing(false); }
  }, [nodes]);

  useEffect(() => { load(); }, [load]);

  const totalUsers  = Object.values(groups).reduce((a, u) => a + u.length, 0);
  const totalOnline = Object.values(groups).reduce((a, u) => a + u.filter(x => x.is_online).length, 0);
  const totalActive = Object.values(groups).reduce((a, u) => a + u.filter(x => x.running).length, 0);

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title">Все <em>клиенты</em></div>
          <div className="page-desc">
            {loading ? '...' : `${totalUsers} клиентов · ${totalActive} активных · ${totalOnline} онлайн · ${nodes.length} нод`}
          </div>
        </div>
        <div className="topbar-right">
          {refreshing && <span className="refreshing"><span className="spin"/></span>}
          <button className="btn btn-ghost btn-sm" onClick={() => load(true)}><I.RefreshCw/> Обновить</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spin"/> Загружаю...</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {nodes.map(node => {
            const users  = groups[node.id] || [];
            const active = users.filter(u => u.running).length;
            const online = users.filter(u => u.is_online).length;
            return (
              <div className="card" key={node.id}>
                {/* Node header */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom: users.length ? 16 : 0}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    {node.flag
                      ? <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:30,height:22,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)',flexShrink:0}}/>
                      : <div className="node-icon" style={{width:30,height:30,borderRadius:7}}><I.Server/></div>}
                    <div>
                      <div style={{fontWeight:600,fontSize:14}}>{node.name}</div>
                      <div style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)'}}>{node.host}</div>
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    {users.length > 0 && (
                      <div style={{display:'flex',gap:6}}>
                        {online > 0 && <span className="badge badge-green"><span className="dot dot-live"/>{online} онлайн</span>}
                        <span className="badge badge-purple">{active} / {users.length}</span>
                      </div>
                    )}
                    <button className="btn btn-primary btn-sm" onClick={() => onSelectNode(node)}>
                      <I.Users/> Управление
                    </button>
                  </div>
                </div>

                {users.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead><tr>
                        <th>Клиент</th>
                        <th>Порт</th>
                        <th>Подключения</th>
                        <th>Трафик</th>
                        <th>Статус</th>
                        <th>Срок</th>
                        <th>Заметка</th>
                        <th></th>
                      </tr></thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id} style={{opacity: u.expired ? 0.55 : 1}}>
                            <td><span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:13}}>{u.name}</span></td>
                            <td><span className="badge badge-purple">{u.port}</span></td>
                            <td>
                              {u.is_online
                                ? <span className="badge badge-green"><span className="dot dot-live"/>{u.connections} онлайн</span>
                                : <span style={{color:'var(--t3)',fontSize:12}}>офлайн</span>}
                            </td>
                            <td>
                              {u.traffic
                                ? <span className="traf">
                                    <span className="rx">↓{u.traffic.rx}</span>
                                    <span className="tx"> ↑{u.traffic.tx}</span>
                                    {!u.traffic.live && <span style={{fontSize:10,color:'var(--t3)',marginLeft:3}} title="Данные на момент остановки">⏸</span>}
                                  </span>
                                : <span style={{color:'var(--t3)',fontSize:11}}>—</span>}
                            </td>
                            <td>
                              <span className={`badge ${u.running ? 'badge-green' : 'badge-red'}`}>
                                <span className={`dot ${u.running ? 'dot-live' : ''}`}/>
                                {u.running ? 'активен' : 'стоп'}
                              </span>
                            </td>
                            <td>{expiryBadge(u.expires_at, true)}</td>
                            <td style={{maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:12,color:'var(--t2)'}} title={u.note}>
                              {u.note || <span style={{color:'var(--t3)'}}>—</span>}
                            </td>
                            <td>
                              <div className="acts">
                                <button className="btn btn-icon btn-secondary btn-sm" onClick={() => copyText(u.link)} title="Копировать ссылку"><I.Copy/></button>
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
                    Нет клиентов на этой ноде
                  </div>
                )}
              </div>
            );
          })}
          {!nodes.length && (
            <div className="empty"><div className="empty-icon"><I.Users/></div><div className="empty-title">Нет нод</div></div>
          )}
        </div>
      )}
    </div>
  );
}
