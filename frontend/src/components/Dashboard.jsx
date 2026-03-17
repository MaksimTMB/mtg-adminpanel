import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import { flagUrl } from '../utils.jsx';
import StatPill from './StatPill.jsx';
import * as I from '../icons.jsx';

export default function Dashboard({ nodes, onSelectNode, onManageNode }) {
  const [status, setStatus]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try { const s = await api('GET', '/api/status'); setStatus(s); }
    catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 15000);
    return () => clearInterval(t);
  }, [load]);

  const totalUsers    = useMemo(() => nodes.reduce((a, n) => a + (n._userCount || 0), 0), [nodes]);
  const onlineNodes   = useMemo(() => status.filter(s => s.online).length, [status]);
  const activeProxies = useMemo(() => status.reduce((a, s) => a + (s.containers || 0), 0), [status]);
  const stoppedProxies = Math.max(0, totalUsers - activeProxies);
  const totalOnline   = useMemo(() => status.reduce((a, s) => a + (s.online_users || 0), 0), [status]);

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title">Панель <em>управления</em></div>
          <div className="page-desc">MTG Proxy AdminPanel</div>
        </div>
        <div className="topbar-right">
          {refreshing && <span className="refreshing"><span className="spin"/></span>}
          <button className="btn btn-ghost btn-sm" onClick={() => load()}><I.RefreshCw/> Обновить</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        <div className="card" style={{padding:'20px 24px'}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:10}}>Ноды</div>
          <div style={{fontSize:42,fontWeight:800,letterSpacing:'-1.5px',color:'var(--t1)',lineHeight:1,marginBottom:14}}>{nodes.length}</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <StatPill count={onlineNodes} label="онлайн" color="34,197,94" dot="dot-live"/>
            {nodes.length - onlineNodes > 0 && <StatPill count={nodes.length - onlineNodes} label="офлайн" color="251,113,133" dot=""/>}
          </div>
        </div>
        <div className="card" style={{padding:'20px 24px'}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:10}}>Клиенты</div>
          <div style={{fontSize:42,fontWeight:800,letterSpacing:'-1.5px',color:'var(--t1)',lineHeight:1,marginBottom:14}}>{totalUsers}</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <StatPill count={activeProxies}  label="активных"   color="34,197,94"  dot="dot-live"/>
            {totalOnline > 0    && <StatPill count={totalOnline}    label="онлайн"      color="56,189,248" dot="dot-live"/>}
            {stoppedProxies > 0 && <StatPill count={stoppedProxies} label="остановлен"  color="251,113,133" dot=""/>}
          </div>
        </div>
      </div>

      <div className="sec-lbl">Ноды</div>
      {loading
        ? <div className="loading-center"><span className="spin"/> Загружаю...</div>
        : (
          <div className="grid-2">
            {nodes.map(node => {
              const s = status.find(x => x.id === node.id) || {};
              const total   = node._userCount || 0;
              const active  = s.containers || 0;
              const stopped = total - active;
              return (
                <div className="card" key={node.id}
                  style={{padding:0,overflow:'hidden',cursor:'pointer',transition:'border-color .15s'}}
                  onClick={() => onSelectNode(node)}>
                  <div style={{padding:'18px 20px 14px',borderBottom:'1px solid var(--b1)',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:5}}>
                        {node.flag && <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:32,height:24,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)',flexShrink:0}}/>}
                        <span style={{fontSize:18,fontWeight:700,letterSpacing:'-0.3px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{node.name}</span>
                      </div>
                      <div style={{fontSize:12,color:'var(--t3)',fontFamily:'var(--mono)'}}>{node.host}</div>
                    </div>
                    <span className={`badge ${s.online ? 'badge-green' : 'badge-red'}`} style={{flexShrink:0}}>
                      <span className={`dot ${s.online ? 'dot-live' : ''}`}/>{s.online ? 'онлайн' : 'офлайн'}
                    </span>
                  </div>
                  <div style={{padding:'12px 20px',display:'flex',gap:8,flexWrap:'wrap',borderBottom:'1px solid var(--b1)'}}>
                    <StatPill count={total}  label="всего"      color="124,111,247" dot={null}/>
                    <StatPill count={active} label="активных"   color="34,197,94"  dot="dot-live"/>
                    {s.online_users > 0 && <StatPill count={s.online_users} label="онлайн" color="56,189,248" dot="dot-live"/>}
                    {stopped > 0 && <StatPill count={stopped} label="остановлен" color="251,113,133" dot=""/>}
                  </div>
                  <div style={{padding:'12px 20px',display:'flex',gap:8}}>
                    <button className="btn btn-primary btn-sm" style={{flex:1,justifyContent:'center'}}
                      onClick={e => { e.stopPropagation(); onManageNode(node); }}>
                      <I.Users/> Клиенты
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{flex:1,justifyContent:'center'}}
                      onClick={e => { e.stopPropagation(); onSelectNode(node); }}>
                      <I.Server/> Нода
                    </button>
                  </div>
                </div>
              );
            })}
            {!nodes.length && (
              <div style={{gridColumn:'1/-1'}}>
                <div className="empty"><div className="empty-icon"><I.Server/></div>
                  <div className="empty-title">Нет нод</div><div className="empty-desc">Добавь первую ноду</div>
                </div>
              </div>
            )}
          </div>
        )
      }
    </div>
  );
}
