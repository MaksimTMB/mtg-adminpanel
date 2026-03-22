import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl, expiryBadge, copyText } from '../utils.jsx';
import { useAppCtx } from '../AppContext.jsx';
import AddUserModal from './AddUserModal.jsx';
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

export default function UsersPage({ node, onBack }) {
  const { t } = useAppCtx();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [ref, setRef]         = useState(false);
  const [modal, setModal]     = useState(false);
  const [busy, setBusy]       = useState({});
  const [editU, setEditU]     = useState(null);
  const [qrU, setQrU]         = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [history, setHistory] = useState({});
  const [search, setSearch]   = useState('');

  const loadHistory = useCallback(async (userList) => {
    if (!userList.length) return;
    await Promise.allSettled(userList.map(async u => {
      try {
        const rows = await api('GET', `/api/nodes/${node.id}/users/${u.name}/history`);
        setHistory(h => ({...h, [u.name]: rows.map(r => r.connections)}));
      } catch {}
    }));
  }, [node.id]);

  const loadUsers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRef(true);
    try {
      const u = await api('GET', `/api/nodes/${node.id}/users`);
      setUsers(u);
      loadHistory(u);
    }
    finally { setLoading(false); setRef(false); }
  }, [node.id, loadHistory]);

  const syncUsers = async () => {
    try {
      const r = await api('POST', `/api/nodes/${node.id}/sync`);
      toast(t.syncDone(r.imported, r.total), r.imported > 0 ? 'success' : 'info');
      loadUsers(true);
    } catch(e) { toast(e.message, 'error'); }
  };

  const copyLink = async (txt) => {
    try { await copyText(txt); toast(t.copied, 'success'); }
    catch { toast(t.copyError, 'error'); }
  };

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    const ti = setInterval(() => loadUsers(true), 30000);
    return () => clearInterval(ti);
  }, [loadUsers]);

  const setBusyFor = (n, v) => setBusy(b => ({...b, [n]: v}));

  const remove = async (user) => {
    setBusyFor(user.name, true);
    try {
      await api('DELETE', `/api/nodes/${node.id}/users/${user.name}`);
      toast(t.userDeleted(user.name), 'success');
      loadUsers(true);
    } catch(e) { toast(e.message, 'error'); }
    finally { setBusyFor(user.name, false); }
  };

  const toggle = async (user) => {
    const action = user.running ? 'stop' : 'start';
    if (action === 'start' && user.expired) {
      if (!confirm(t.expiredWarning(user.name))) return;
    }
    setUsers(p => p.map(u => u.name === user.name ? {...u, running: !user.running} : u));
    setBusyFor(user.name, true);
    try {
      await api('POST', `/api/nodes/${node.id}/users/${user.name}/${action}`);
      toast(action === 'stop' ? t.userStopped(user.name) : t.userStarted(user.name), 'success');
    } catch(e) {
      setUsers(p => p.map(u => u.name === user.name ? {...u, running: user.running} : u));
      toast(e.message, 'error');
    }
    finally { setBusyFor(user.name, false); }
  };

  const resetTraffic = async (user) => {
    if (!confirm(`${t.resetTrafficTitle}\n${user.name}?`)) return;
    setBusyFor(user.name + '_reset', true);
    try {
      await api('POST', `/api/nodes/${node.id}/users/${user.name}/reset-traffic`);
      toast(t.trafficReset(user.name), 'success');
      loadUsers(true);
      setTimeout(() => loadUsers(true), 1500);
    } catch(e) { toast(e.message, 'error'); }
    finally { setBusyFor(user.name + '_reset', false); }
  };

  const periodLabel = (u) => (
    <span className="traf">
      <span className="rx">↓{u.current_traffic_rx || '0B'}</span>
      <span className="tx"> ↑{u.current_traffic_tx || '0B'}</span>
      {!u.running && (u.current_traffic_rx_bytes > 0 || u.current_traffic_tx_bytes > 0) && (
        <span style={{fontSize:10,color:'var(--t3)',marginLeft:4}} title="Сохранено между остановками">⏸</span>
      )}
    </span>
  );

  const totalLabel = (u) => (
    <span className="traf" title="Накопленный трафик за всё время, включая текущий период">
      <span className="rx">↓{u.lifetime_traffic_rx || '0B'}</span>
      <span className="tx"> ↑{u.lifetime_traffic_tx || '0B'}</span>
    </span>
  );

  const intervalShort = (iv) =>
    iv === 'daily' ? t.intervalDaily.split(' ')[1] || 'day'
    : iv === 'monthly' ? t.intervalMonthly.split(' ')[1] || 'mo'
    : t.intervalYearly.split(' ')[1] || 'yr';

  const q = search.trim().toLowerCase();
  const filtered = q
    ? users.filter(u =>
        u.name.toLowerCase().includes(q) ||
        (u.note && u.note.toLowerCase().includes(q)) ||
        String(u.port).includes(q))
    : users;

  return (
    <div className="pg">
      <div className="topbar users-topbar">
        <div className="topbar-left users-topbar-left" style={{display:'flex',alignItems:'center',gap:14}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}><I.ArrowLeft/> {t.back}</button>
          <div className="users-topbar-node" style={{display:'flex',alignItems:'center',gap:10}}>
            {node.flag && <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:30,height:22,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)',flexShrink:0}}/>}
            <div>
              <div className="page-title" style={{marginBottom:0}}><em>{node.name}</em></div>
              <div className="page-desc" style={{marginTop:0}}>{node.host}</div>
            </div>
          </div>
        </div>
        <div className="topbar-right users-topbar-actions">
          {ref && <span className="refreshing"><span className="spin"/></span>}
          <input className="form-input search-input" placeholder={t.searchPlaceholder}
            value={search} onChange={e => setSearch(e.target.value)}
            style={{width:160,height:30,padding:'0 10px',fontSize:13}}/>
          <button className="btn btn-ghost btn-sm" onClick={() => loadUsers(true)}><I.RefreshCw/></button>
          <button className="btn btn-secondary btn-sm" onClick={syncUsers}><I.Sync/> {t.syncBtn}</button>
          <button className="btn btn-primary btn-sm" onClick={() => setModal(true)}><I.Plus/> {t.add}</button>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading-center"><span className="spin"/> {t.loading}</div> : (
          <div className="table-wrap user-table-desktop">
            <table>
              <thead><tr>
                <th>{t.colClient}</th>
                <th>{t.colPort}</th>
                <th>{t.colStatus}</th>
                <th>{t.colConnections}</th>
                <th>{t.colTraffic}</th>
                <th>{t.colTotal}</th>
                <th>{t.colLimits}</th>
                <th>{t.colNote}</th>
                <th>{t.colActions}</th>
              </tr></thead>
              <tbody>
                {filtered.map(u => {
                  const devLimit = u.max_devices;
                  const devOver  = devLimit && u.connections > devLimit;
                  const hist     = history[u.name];
                  return (
                    <tr key={u.id}>
                      <td><span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:14}}>{u.name}</span></td>
                      <td><span className="badge badge-purple">{u.port}</span></td>
                      <td>
                        <span className={`badge ${u.running ? 'badge-green' : 'badge-red'}`}>
                          <span className={`dot ${u.running ? 'dot-live' : ''}`}/>
                          {u.running ? t.running : t.stop}
                        </span>
                      </td>
                      <td>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {u.is_online
                            ? <span className={`badge ${devOver ? 'badge-red' : 'badge-green'}`}
                                title={devLimit ? `${t.maxDevicesLabel}: ${devLimit}` : ''}>
                                <span className="dot dot-live"/>
                                {u.connections} {t.online}{devLimit ? ` / ${devLimit}` : ''}
                              </span>
                            : <span style={{color:'var(--t3)',fontSize:12}}>{t.offline}</span>}
                          {hist && hist.length > 1 && (
                            <Sparkline data={hist} color={u.is_online ? 'var(--gr)' : 'var(--t3)'}/>
                          )}
                        </div>
                      </td>
                      <td>
                        {(u.current_traffic_rx_bytes > 0 || u.current_traffic_tx_bytes > 0)
                          ? periodLabel(u)
                          : <span style={{color:'var(--t3)',fontSize:12}}>—</span>}
                      </td>
                      <td>
                        {(u.lifetime_traffic_rx_bytes > 0 || u.lifetime_traffic_tx_bytes > 0)
                          ? totalLabel(u)
                          : <span style={{color:'var(--t3)',fontSize:12}}>—</span>}
                      </td>
                      <td>
                        <div style={{display:'flex',flexDirection:'column',gap:3}}>
                          {u.expires_at && <div>{expiryBadge(u.expires_at)}</div>}
                          {u.traffic_limit_gb && <span style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)'}}>{u.traffic_limit_gb}GB</span>}
                          {!u.expires_at && !u.traffic_limit_gb && <span style={{color:'var(--t3)',fontSize:12}}>∞</span>}
                          {u.traffic_reset_interval && u.traffic_reset_interval !== 'never' && (
                            <span style={{fontSize:10,color:'var(--vi)'}} title={u.next_reset_at ? `${new Date(u.next_reset_at).toLocaleString(t.dateLocale)}` : ''}>
                              ↺ {intervalShort(u.traffic_reset_interval)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13,color:'var(--t2)'}} title={u.note}>
                        {u.note || <span style={{color:'var(--t3)'}}>—</span>}
                      </td>
                      <td>
                        <div className="acts">
                          <button className={`btn btn-icon btn-sm ${u.running ? 'btn-ghost' : 'btn-primary'}`}
                            onClick={() => toggle(u)} disabled={busy[u.name]} title={u.running ? t.stopTitle : t.startTitle}>
                            {busy[u.name] ? <span className="spin spin-sm"/> : (u.running ? <I.Pause/> : <I.Play/>)}
                          </button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => copyLink(u.link)} title={t.copyLinkTitle}><I.Copy/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setQrU(u)} title="QR"><I.QrCode/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setEditU(u)} title={t.edit}><I.Edit/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => resetTraffic(u)}
                            disabled={busy[u.name + '_reset']} title={t.resetTrafficTitle}>
                            {busy[u.name + '_reset'] ? <span className="spin spin-sm"/> : <I.RefreshCw/>}
                          </button>
                          <button className="btn btn-icon btn-danger btn-sm" onClick={() => setConfirmDel(u)} disabled={busy[u.name]} title={t.delete}><I.Trash/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan={9}><div className="empty"><div className="empty-icon"><I.Users/></div><div className="empty-title">{q ? t.searchNoResults : t.noClients}</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && (
        <div className="mobile-user-list">
          {filtered.map(u => {
            const devLimit = u.max_devices;
            const devOver  = devLimit && u.connections > devLimit;
            const hist     = history[u.name];
            return (
              <div className="mobile-user-card card" key={`mobile-${u.id}`}>
                <div className="mobile-user-head">
                  <div>
                    <div className="mobile-user-name">{u.name}</div>
                    <div className="mobile-user-port">{t.mobilePort}{u.port}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}}>
                    <span className={`badge ${u.running ? 'badge-green' : 'badge-red'}`}>
                      <span className={`dot ${u.running ? 'dot-live' : ''}`}/>
                      {u.running ? t.running : t.stop}
                    </span>
                    {u.expired && <span className="badge badge-amber">истёк</span>}
                  </div>
                </div>

                <div className="mobile-user-grid">
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">{t.mobileConnections}</span>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {u.is_online
                        ? <span className={`badge ${devOver ? 'badge-red' : 'badge-green'}`}>
                            <span className="dot dot-live"/>
                            {u.connections}{devLimit ? ` / ${devLimit}` : ''} {t.online}
                          </span>
                        : <span className="mobile-muted">{t.offline}</span>}
                      {hist && hist.length > 1 && (
                        <Sparkline data={hist} color={u.is_online ? 'var(--gr)' : 'var(--t3)'} width={80} height={22}/>
                      )}
                    </div>
                  </div>
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">{t.mobilePeriodTraffic}</span>
                    {(u.current_traffic_rx_bytes > 0 || u.current_traffic_tx_bytes > 0) ? periodLabel(u) : <span className="mobile-muted">—</span>}
                  </div>
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">{t.colTotal}</span>
                    {(u.lifetime_traffic_rx_bytes > 0 || u.lifetime_traffic_tx_bytes > 0) ? totalLabel(u) : <span className="mobile-muted">—</span>}
                  </div>
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">{t.colLimits}</span>
                    <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-start'}}>
                      {u.expires_at && <div>{expiryBadge(u.expires_at)}</div>}
                      {u.traffic_limit_gb && <span style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)'}}>{u.traffic_limit_gb}GB</span>}
                      {!u.expires_at && !u.traffic_limit_gb && <span className="mobile-muted">∞</span>}
                      {u.traffic_reset_interval && u.traffic_reset_interval !== 'never' && (
                        <span style={{fontSize:10,color:'var(--vi)'}}>↺ {intervalShort(u.traffic_reset_interval)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {u.note && <div className="mobile-user-note">{u.note}</div>}

                <div className="mobile-user-actions">
                  <button className={`btn btn-sm ${u.running ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => toggle(u)} disabled={busy[u.name]}>
                    {busy[u.name] ? <span className="spin spin-sm"/> : (u.running ? <I.Pause/> : <I.Play/>)}
                    {u.running ? t.mobileStop : t.mobileStart}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyLink(u.link)}><I.Copy/> {t.mobileLink}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setQrU(u)}><I.QrCode/> QR</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditU(u)}><I.Edit/> {t.edit}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => resetTraffic(u)}
                    disabled={busy[u.name + '_reset']}>
                    {busy[u.name + '_reset'] ? <span className="spin spin-sm"/> : <I.RefreshCw/>}
                    {t.mobileReset}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirmDel(u)} disabled={busy[u.name]}><I.Trash/> {t.delete}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <AddUserModal nodeId={node.id} onClose={() => setModal(false)} onSave={() => { setModal(false); loadUsers(true); }}/>}
      {qrU   && <QRModal user={qrU} onClose={() => setQrU(null)}/>}
      {editU && <EditModal user={editU} nodeId={node.id} onClose={() => setEditU(null)} onSave={() => { setEditU(null); loadUsers(true); }}/>}
      {confirmDel && (
        <ConfirmModal
          title={t.deleteClientTitle}
          message={<>{t.deleteClientMsgPre} <strong>{confirmDel.name}</strong> {t.deleteClientMsgPost}</>}
          confirmText={t.deleteClientBtn}
          onConfirm={() => remove(confirmDel)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
