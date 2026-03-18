import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl, expiryBadge } from '../utils.jsx';
import StatPill from './StatPill.jsx';
import NodeModal from './NodeModal.jsx';
import * as I from '../icons.jsx';

export default function NodePage({ node, onBack, onManage, onReload }) {
  const [status, setStatus]     = useState(null);
  const [users, setUsers]       = useState([]);
  const [traffic, setTraffic]   = useState({});
  const [loading, setLoading]   = useState(true);
  const [modalEdit, setModalEdit] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // One request instead of three — backend makes single agent call
      const s = await api('GET', `/api/nodes/${node.id}/summary`);
      setStatus({ online: s.online });
      setUsers(s.users || []);
      setTraffic(s.traffic || {});
    } catch {} finally { setLoading(false); }
  }, [node.id]);

  useEffect(() => {
    loadData();
    const t = setInterval(loadData, 20000);
    return () => clearInterval(t);
  }, [loadData]);

  const isOnline    = status ? status.online : null;
  const active      = users.filter(u => u.running).length;
  const stopped     = users.filter(u => !u.running).length;
  const onlineUsers = users.filter(u => u.is_online).length;

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left" style={{display:'flex',alignItems:'center',gap:14}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}><I.ArrowLeft/> Назад</button>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {node.flag && <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:32,height:24,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)'}}/>}
            <div>
              <div className="page-title" style={{marginBottom:0}}><em>{node.name}</em></div>
              <div style={{fontSize:12,color:'var(--t3)',fontFamily:'var(--mono)'}}>{node.host}</div>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={loadData}><I.RefreshCw/></button>
          <button className="btn btn-secondary btn-sm" onClick={() => setModalEdit(true)}><I.Edit/> Настройки</button>
          <button className="btn btn-primary btn-sm" onClick={() => onManage(node)}><I.Users/> Клиенты</button>
        </div>
      </div>

      <div className="card" style={{marginBottom:16,padding:'18px 20px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:14}}>
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            <div><div style={{fontSize:11,color:'var(--t3)',marginBottom:4}}>SSH</div>
              <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--t2)'}}>{node.ssh_user}@{node.host}:{node.ssh_port}</div></div>
            <div><div style={{fontSize:11,color:'var(--t3)',marginBottom:4}}>Базовая директория</div>
              <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--t2)'}}>{node.base_dir}</div></div>
            <div><div style={{fontSize:11,color:'var(--t3)',marginBottom:4}}>Начальный порт</div>
              <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--t2)'}}>{node.start_port}</div></div>
            {node.agent_port && (
              <div><div style={{fontSize:11,color:'var(--t3)',marginBottom:4}}>Агент</div>
                <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--vi)'}}>:{node.agent_port}</div></div>
            )}
          </div>
          <span className={`badge ${isOnline === null ? '' : isOnline ? 'badge-green' : 'badge-red'}`} style={{fontSize:13,padding:'8px 14px'}}>
            <span className={`dot ${isOnline ? 'dot-live' : ''}`}/>
            {isOnline === null ? 'проверка...' : isOnline ? 'онлайн' : 'офлайн'}
          </span>
        </div>
      </div>

      {!loading && (
        <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
          <StatPill count={users.length} label="Всего"       color="124,111,247" dot={null}     large/>
          <StatPill count={active}       label="Активных"    color="34,197,94"  dot="dot-live"  large/>
          <StatPill count={onlineUsers}  label="Онлайн"      color="56,189,248" dot="dot-live"  large/>
          {stopped > 0 && <StatPill count={stopped} label="Остановлен" color="251,113,133" dot="" large/>}
        </div>
      )}

      <div className="card">
        {loading ? <div className="loading-center"><span className="spin"/> Загружаю...</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Клиент</th><th>Порт</th><th>Онлайн</th><th>Устройств</th>
                <th>Трафик</th><th>Статус</th><th>Срок</th><th>Действия</th>
              </tr></thead>
              <tbody>
                {users.map(u => {
                  const traf = u.running ? traffic[u.name] : (u.traffic_rx_snap ? {rx:u.traffic_rx_snap, tx:u.traffic_tx_snap} : traffic[u.name]);
                  return (
                    <tr key={u.id}>
                      <td><span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:14}}>{u.name}</span></td>
                      <td><span className="badge badge-purple">{u.port}</span></td>
                      <td>{u.is_online ? <span className="badge badge-green"><span className="dot dot-live"/>онлайн</span> : <span style={{color:'var(--t3)',fontSize:12}}>—</span>}</td>
                      <td><span style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:14,color:u.connections>0?'var(--vi)':'var(--t3)'}}>{u.connections}{u.max_devices?`/${u.max_devices}`:''}</span></td>
                      <td>{traf ? <span className="traf"><span className="rx">↓{traf.rx}</span><span className="tx"> ↑{traf.tx}</span></span> : <span style={{color:'var(--t3)',fontSize:12}}>—</span>}</td>
                      <td><span className={`badge ${u.running?'badge-green':'badge-red'}`}><span className={`dot ${u.running?'dot-live':''}`}/>{u.running?'активен':'остановлен'}</span></td>
                      <td>{expiryBadge(u.expires_at)}</td>
                      <td>
                        <div className="acts">
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(u.link).then(() => toast('Скопировано!','success'))} title="Копировать ссылку"><I.Copy/></button>
                          <button className="btn btn-icon btn-secondary btn-sm" onClick={() => onManage(node)} title="Управление клиентом"><I.Edit/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!users.length && <tr><td colSpan={8}><div className="empty"><div className="empty-icon"><I.Users/></div><div className="empty-title">Нет клиентов</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalEdit && <NodeModal node={node} onClose={() => setModalEdit(false)} onSave={() => { setModalEdit(false); onReload(); }}/>}
    </div>
  );
}
