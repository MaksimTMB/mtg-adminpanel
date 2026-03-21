import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl, expiryBadge, copyText } from '../utils.jsx';
import AddUserModal from './AddUserModal.jsx';
import EditModal from './EditModal.jsx';
import QRModal from './QRModal.jsx';
import * as I from '../icons.jsx';

export default function UsersPage({ node, onBack }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [ref, setRef]         = useState(false);
  const [modal, setModal]     = useState(false);
  const [busy, setBusy]       = useState({});
  const [editU, setEditU]     = useState(null);
  const [qrU, setQrU]         = useState(null);
  const loadUsers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRef(true);
    try {
      const u = await api('GET', `/api/nodes/${node.id}/users`);
      setUsers(u);
    }
    finally { setLoading(false); setRef(false); }
  }, [node.id]);

  const syncUsers = async () => {
    try {
      const r = await api('POST', `/api/nodes/${node.id}/sync`);
      toast(`Синхронизировано: ${r.imported} новых из ${r.total}`, r.imported > 0 ? 'success' : 'info');
      loadUsers(true);
    } catch(e) { toast(e.message, 'error'); }
  };

  const copyLink = async (txt) => {
    try {
      await copyText(txt);
      toast('Скопировано!', 'success');
    } catch {
      toast('Не удалось скопировать. Зажми ссылку и скопируй вручную.', 'error');
    }
  };

  // Single polling interval — users endpoint now includes traffic
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    const t = setInterval(() => loadUsers(true), 30000);
    return () => clearInterval(t);
  }, [loadUsers]);

  const setBusyFor = (n, v) => setBusy(b => ({...b, [n]: v}));

  const remove = async (user) => {
    if (!confirm(`Удалить ${user.name}?`)) return;
    setBusyFor(user.name, true);
    try {
      await api('DELETE', `/api/nodes/${node.id}/users/${user.name}`);
      toast(`${user.name} удалён`, 'success');
      loadUsers(true);
    } catch(e) { toast(e.message, 'error'); }
    finally { setBusyFor(user.name, false); }
  };

  const toggle = async (user) => {
    const action = user.running ? 'stop' : 'start';
    if (action === 'start' && user.expired) {
      if (!confirm(`Срок действия клиента ${user.name} истёк.\nОн будет автоматически остановлен заново.\nЧтобы продлить — обнови дату в настройках клиента.\n\nВсё равно запустить?`)) return;
    }
    setUsers(p => p.map(u => u.name === user.name ? {...u, running: !user.running} : u));
    setBusyFor(user.name, true);
    try {
      await api('POST', `/api/nodes/${node.id}/users/${user.name}/${action}`);
      toast(`${user.name}: ${action === 'stop' ? 'остановлен' : 'запущен'}`, 'success');
    } catch(e) {
      setUsers(p => p.map(u => u.name === user.name ? {...u, running: user.running} : u));
      toast(e.message, 'error');
    }
    finally { setBusyFor(user.name, false); }
  };

  const resetTraffic = async (user) => {
    if (!confirm(`Сбросить трафик ${user.name}? Прокси будет перезапущен.`)) return;
    setBusyFor(user.name + '_reset', true);
    try {
      await api('POST', `/api/nodes/${node.id}/users/${user.name}/reset-traffic`);
      toast(`${user.name}: трафик сброшен`, 'success');
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

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left" style={{display:'flex',alignItems:'center',gap:14}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}><I.ArrowLeft/> Назад</button>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {node.flag && <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:30,height:22,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)',flexShrink:0}}/>}
            <div>
              <div className="page-title" style={{marginBottom:0}}><em>{node.name}</em></div>
              <div className="page-desc" style={{marginTop:0}}>{node.host}</div>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          {ref && <span className="refreshing"><span className="spin"/> обновление</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => loadUsers(true)}><I.RefreshCw/></button>
          <button className="btn btn-secondary btn-sm" onClick={syncUsers}><I.Sync/> Синхр.</button>
          <button className="btn btn-primary btn-sm" onClick={() => setModal(true)}><I.Plus/> Добавить</button>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading-center"><span className="spin"/> Загружаю...</div> : (
          <div className="table-wrap user-table-desktop">
            <table>
              <thead><tr>
                <th>Клиент</th>
                <th>Порт</th>
                <th>Статус</th>
                <th>Подключения</th>
                <th>Трафик</th>
                <th>Всего</th>
                <th>Срок / Лимит</th>
                <th>Заметка</th>
                <th>Действия</th>
              </tr></thead>
              <tbody>
                {users.map(u => {
                  const devLimit = u.max_devices;
                  const devOver  = devLimit && u.connections > devLimit;
                  return (
                    <tr key={u.id}>
                      <td><span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:14}}>{u.name}</span></td>
                      <td><span className="badge badge-purple">{u.port}</span></td>

                      {/* Статус: running/stopped + expired */}
                      <td>
                        <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'flex-start'}}>
                          <span className={`badge ${u.running ? 'badge-green' : 'badge-red'}`}>
                            <span className={`dot ${u.running ? 'dot-live' : ''}`}/>
                            {u.running ? 'активен' : 'стоп'}
                          </span>
                          {u.expired && <span className="badge badge-amber">истёк</span>}
                        </div>
                      </td>

                      {/* Подключения: онлайн-бейдж с количеством устройств */}
                      <td>
                        {u.is_online
                          ? <span
                              className={`badge ${devOver ? 'badge-red' : 'badge-green'}`}
                              title={devLimit ? `Лимит: ${devLimit} устройств` : 'Без ограничений'}
                            >
                              <span className="dot dot-live"/>
                              {u.connections} онлайн{devLimit ? ` / ${devLimit}` : ''}
                            </span>
                          : <span style={{color:'var(--t3)',fontSize:12}}>офлайн</span>}
                      </td>

                      {/* Трафик: live или snapshot */}
                      <td>
                        {(u.current_traffic_rx_bytes > 0 || u.current_traffic_tx_bytes > 0)
                          ? periodLabel(u)
                          : <span style={{color:'var(--t3)',fontSize:12}}>—</span>}
                      </td>

                      {/* Всего за всё время */}
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
                            <span style={{fontSize:10,color:'var(--vi)'}} title={u.next_reset_at ? `Следующий: ${new Date(u.next_reset_at).toLocaleString('ru-RU')}` : ''}>
                              ↺ {u.traffic_reset_interval === 'daily' ? 'день' : u.traffic_reset_interval === 'monthly' ? 'мес' : 'год'}
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
                            onClick={() => toggle(u)} disabled={busy[u.name]} title={u.running ? 'Остановить' : 'Запустить'}>
                            {busy[u.name] ? <span className="spin spin-sm"/> : (u.running ? <I.Pause/> : <I.Play/>)}
                          </button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => copyLink(u.link)} title="Копировать ссылку"><I.Copy/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setQrU(u)} title="QR-код"><I.QrCode/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setEditU(u)} title="Редактировать"><I.Edit/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => resetTraffic(u)}
                            disabled={busy[u.name + '_reset']} title="Сбросить трафик (перезапуск прокси)">
                            {busy[u.name + '_reset'] ? <span className="spin spin-sm"/> : <I.RefreshCw/>}
                          </button>
                          <button className="btn btn-icon btn-danger btn-sm" onClick={() => remove(u)} disabled={busy[u.name]} title="Удалить"><I.Trash/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!users.length && <tr><td colSpan={9}><div className="empty"><div className="empty-icon"><I.Users/></div><div className="empty-title">Нет клиентов</div><div className="empty-desc">Добавь первого клиента</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && (
        <div className="mobile-user-list">
          {users.map(u => {
            const devLimit = u.max_devices;
            const devOver  = devLimit && u.connections > devLimit;
            return (
              <div className="mobile-user-card card" key={`mobile-${u.id}`}>
                <div className="mobile-user-head">
                  <div>
                    <div className="mobile-user-name">{u.name}</div>
                    <div className="mobile-user-port">Порт {u.port}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}}>
                    <span className={`badge ${u.running ? 'badge-green' : 'badge-red'}`}>
                      <span className={`dot ${u.running ? 'dot-live' : ''}`}/>
                      {u.running ? 'активен' : 'стоп'}
                    </span>
                    {u.expired && <span className="badge badge-amber">истёк</span>}
                  </div>
                </div>

                <div className="mobile-user-grid">
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">Подключения</span>
                    {u.is_online
                      ? <span className={`badge ${devOver ? 'badge-red' : 'badge-green'}`} title={devLimit ? `Лимит: ${devLimit}` : 'Без ограничений'}>
                          <span className="dot dot-live"/>
                          {u.connections}{devLimit ? ` / ${devLimit}` : ''} онлайн
                        </span>
                      : <span className="mobile-muted">офлайн</span>}
                  </div>
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">Текущий период</span>
                    {(u.current_traffic_rx_bytes > 0 || u.current_traffic_tx_bytes > 0) ? periodLabel(u) : <span className="mobile-muted">—</span>}
                  </div>
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">Общий трафик</span>
                    {(u.lifetime_traffic_rx_bytes > 0 || u.lifetime_traffic_tx_bytes > 0) ? totalLabel(u) : <span className="mobile-muted">—</span>}
                  </div>
                  <div className="mobile-metric">
                    <span className="mobile-metric-label">Срок / лимиты</span>
                    <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-start'}}>
                      {u.expires_at && <div>{expiryBadge(u.expires_at)}</div>}
                      {u.traffic_limit_gb && <span style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)'}}>{u.traffic_limit_gb}GB</span>}
                      {!u.expires_at && !u.traffic_limit_gb && <span className="mobile-muted">∞</span>}
                      {u.traffic_reset_interval && u.traffic_reset_interval !== 'never' && (
                        <span style={{fontSize:10,color:'var(--vi)'}} title={u.next_reset_at ? `Следующий: ${new Date(u.next_reset_at).toLocaleString('ru-RU')}` : ''}>
                          ↺ {u.traffic_reset_interval === 'daily' ? 'день' : u.traffic_reset_interval === 'monthly' ? 'мес' : 'год'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {u.note && <div className="mobile-user-note">{u.note}</div>}

                <div className="mobile-user-actions">
                  <button className={`btn btn-sm ${u.running ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => toggle(u)} disabled={busy[u.name]} title={u.running ? 'Остановить' : 'Запустить'}>
                    {busy[u.name] ? <span className="spin spin-sm"/> : (u.running ? <I.Pause/> : <I.Play/>)}
                    {u.running ? 'Стоп' : 'Старт'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyLink(u.link)} title="Копировать ссылку"><I.Copy/> Ссылка</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setQrU(u)} title="QR-код"><I.QrCode/> QR</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditU(u)} title="Редактировать"><I.Edit/> Изм.</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => resetTraffic(u)}
                    disabled={busy[u.name + '_reset']} title="Сбросить трафик (перезапуск прокси)">
                    {busy[u.name + '_reset'] ? <span className="spin spin-sm"/> : <I.RefreshCw/>}
                    Сброс
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(u)} disabled={busy[u.name]} title="Удалить"><I.Trash/> Удалить</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <AddUserModal nodeId={node.id} onClose={() => setModal(false)} onSave={() => { setModal(false); loadUsers(true); }}/>}
      {qrU   && <QRModal user={qrU} onClose={() => setQrU(null)}/>}
      {editU && <EditModal user={editU} nodeId={node.id} onClose={() => setEditU(null)} onSave={() => { setEditU(null); loadUsers(true); }}/>}
    </div>
  );
}
