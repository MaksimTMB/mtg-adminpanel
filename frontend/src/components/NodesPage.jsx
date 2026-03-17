import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { flagUrl } from '../utils.jsx';
import StatPill from './StatPill.jsx';
import NodeModal from './NodeModal.jsx';
import * as I from '../icons.jsx';

export default function NodesPage({ nodes, onReload, onManage, onOpenNode }) {
  const [modal, setModal]   = useState(false);
  const [edit, setEdit]     = useState(null);
  const [status, setStatus] = useState([]);

  const loadStatus = useCallback(async () => {
    try { const s = await api('GET', '/api/status'); setStatus(s); } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 20000);
    return () => clearInterval(t);
  }, [loadStatus]);

  const del = async (node) => {
    if (!confirm(`Удалить ноду ${node.name}?`)) return;
    try { await api('DELETE', `/api/nodes/${node.id}`); toast('Нода удалена', 'success'); onReload(); }
    catch(e) { toast(e.message, 'error'); }
  };

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title"><em>Ноды</em></div>
          <div className="page-desc">{nodes.length} серверов настроено</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-primary" onClick={() => { setEdit(null); setModal(true); }}>
            <I.Plus/> Добавить ноду
          </button>
        </div>
      </div>

      {!nodes.length
        ? <div className="card"><div className="empty"><div className="empty-icon"><I.Server/></div><div className="empty-title">Нет нод</div><div className="empty-desc">Добавь первую ноду</div></div></div>
        : (
          <div className="grid-2">
            {nodes.map(node => {
              const s = status.find(x => x.id === node.id) || {};
              const total   = node._userCount || 0;
              const active  = s.containers || 0;
              const stopped = total - active;
              return (
                <div className="card" key={node.id} style={{padding:0,overflow:'hidden',cursor:'pointer'}}
                  onClick={() => onOpenNode(node)}>
                  <div style={{padding:'18px 20px 14px',borderBottom:'1px solid var(--b1)',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:5}}>
                        {node.flag && <img src={flagUrl(node.flag,'w80')} alt={node.flag} style={{width:32,height:24,objectFit:'cover',borderRadius:3,boxShadow:'0 1px 4px rgba(0,0,0,.3)',flexShrink:0}}/>}
                        <span style={{fontSize:17,fontWeight:700,letterSpacing:'-0.3px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{node.name}</span>
                        {node.agent_port && <span className="badge badge-purple" style={{fontSize:10,padding:'2px 6px'}}>Agent</span>}
                      </div>
                      <div style={{fontSize:12,color:'var(--t3)',fontFamily:'var(--mono)'}}>{node.host}</div>
                    </div>
                    <span className={`badge ${s.online ? 'badge-green' : 'badge-red'}`} style={{flexShrink:0}}>
                      <span className={`dot ${s.online ? 'dot-live' : ''}`}/>{s.online ? 'онлайн' : 'офлайн'}
                    </span>
                  </div>
                  <div style={{padding:'11px 20px',display:'flex',gap:8,flexWrap:'wrap',borderBottom:'1px solid var(--b1)'}}>
                    <StatPill count={total}  label="всего"      color="124,111,247" dot={null}/>
                    <StatPill count={active} label="активных"   color="34,197,94"  dot="dot-live"/>
                    {s.online_users > 0 && <StatPill count={s.online_users} label="онлайн" color="56,189,248" dot="dot-live"/>}
                    {stopped > 0 && <StatPill count={stopped} label="остановлен" color="251,113,133" dot=""/>}
                  </div>
                  <div style={{padding:'11px 20px',display:'flex',gap:8,alignItems:'center'}}>
                    <button className="btn btn-primary btn-sm" style={{flex:1,justifyContent:'center'}}
                      onClick={e => { e.stopPropagation(); onManage(node); }}>
                      <I.Users/> Клиенты
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setEdit(node); setModal(true); }}>
                      <I.Edit/>
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); del(node); }}>
                      <I.Trash/>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
      {modal && <NodeModal node={edit} onClose={() => setModal(false)} onSave={() => { setModal(false); onReload(); }}/>}
    </div>
  );
}
