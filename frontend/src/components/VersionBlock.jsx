import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import * as I from '../icons.jsx';

function parseVer(raw) {
  if (!raw || raw === 'error' || raw === 'unknown') return { name: raw || '—', date: null };
  const m = raw.match(/^([\w:.]+)\s*\|\s*built\s+([\d-T:.Z]+)/);
  if (m) {
    const d = new Date(m[2]);
    const date = isNaN(d) ? null : d.toLocaleDateString('ru-RU', {day:'2-digit',month:'short',year:'numeric'});
    return { name: m[1], date };
  }
  return { name: raw.slice(0, 20), date: null };
}

export default function VersionBlock({ nodes, panelVersion }) {
  const [versions, setVersions]             = useState({});
  const [agentVersions, setAgentVersions]   = useState({});
  const [updating, setUpdating]             = useState({});
  const [checking, setChecking]             = useState(false);
  const [open, setOpen]                     = useState(false);
  const [latestRelease, setLatestRelease]   = useState(null);
  const [checkingRelease, setCheckingRelease] = useState(false);

  const checkVersions = useCallback(async () => {
    if (!nodes.length) return;
    setChecking(true);
    await Promise.allSettled(nodes.map(async n => {
      try {
        const [mtg, agent] = await Promise.allSettled([
          api('GET', `/api/nodes/${n.id}/mtg-version`),
          api('GET', `/api/nodes/${n.id}/agent-version`),
        ]);
        if (mtg.status === 'fulfilled')
          setVersions(v => ({...v, [n.id]: mtg.value.version || 'unknown'}));
        else
          setVersions(v => ({...v, [n.id]: 'error'}));
        if (agent.status === 'fulfilled' && agent.value.available)
          setAgentVersions(v => ({...v, [n.id]: agent.value.version || 'unknown'}));
        else
          setAgentVersions(v => ({...v, [n.id]: null}));
      } catch {
        setVersions(v => ({...v, [n.id]: 'error'}));
      }
    }));
    setChecking(false);
  }, [nodes]);

  const checkLatestRelease = useCallback(async () => {
    setCheckingRelease(true);
    try {
      const r = await fetch('https://api.github.com/repos/MaksimTMB/mtg-adminpanel/releases/latest');
      const data = await r.json();
      if (data.tag_name) setLatestRelease({ tag: data.tag_name, url: data.html_url });
    } catch {}
    finally { setCheckingRelease(false); }
  }, []);

  useEffect(() => { if (nodes.length) checkVersions(); }, [nodes.length]);
  useEffect(() => { if (open && !latestRelease) checkLatestRelease(); }, [open]);

  const updateNode = async (node) => {
    setUpdating(u => ({...u, [node.id]: true}));
    try {
      await api('POST', `/api/nodes/${node.id}/mtg-update`);
      toast(`${node.name}: MTG обновлён`, 'success');
      setTimeout(checkVersions, 3000);
    } catch(e) { toast(e.message, 'error'); }
    finally { setUpdating(u => ({...u, [node.id]: false})); }
  };

  const updateAllNodes = async () => {
    for (const n of nodes) await updateNode(n);
  };

  if (!nodes.length) return null;

  const vList      = Object.values(versions).map(parseVer);
  const names      = [...new Set(vList.map(v => v.name).filter(v => v && v !== 'error' && v !== '—'))];
  const sidebarTag = checking ? null : names.length === 1 ? names[0] : names.length > 1 ? 'разные' : null;
  const anyError   = Object.values(versions).some(v => v === 'error');

  return (
    <>
      <button className="version-sidebar-btn" onClick={() => setOpen(true)}>
        <I.Activity/>
        Версии
        {checking
          ? <span className="version-sidebar-tag load"><span className="spin spin-sm" style={{width:8,height:8}}/></span>
          : sidebarTag
            ? <span className={`version-sidebar-tag ${anyError ? 'warn' : 'ok'}`}>{sidebarTag}</span>
            : null
        }
      </button>

      {open && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{maxWidth:700}}>
            <div className="modal-head">
              <div className="modal-title"><I.Activity/> Версии и обновления</div>
              <button className="modal-close" onClick={() => setOpen(false)}><I.X/></button>
            </div>

            <div className="modal-body" style={{padding:'16px 20px'}}>
              <div style={{marginBottom:20,padding:'14px 16px',background:'var(--bg3)',borderRadius:10,border:'1px solid var(--b1)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:34,height:34,borderRadius:9,background:'var(--grad)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <I.Zap/>
                    </div>
                    <div>
                      <div style={{fontWeight:600,fontSize:13}}>MTG AdminPanel</div>
                      <div style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)',marginTop:3,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span>Установлена: <span style={{color:'var(--vi)'}}>{panelVersion || '...'}</span></span>
                        {checkingRelease
                          ? <span style={{color:'var(--t3)',display:'inline-flex',alignItems:'center',gap:4}}><span className="spin spin-sm" style={{width:9,height:9}}/> проверяю...</span>
                          : latestRelease && panelVersion
                            ? latestRelease.tag !== panelVersion
                              ? <span className="badge badge-amber" style={{fontSize:10}}>↑ новая {latestRelease.tag}</span>
                              : <span className="badge badge-green" style={{fontSize:10}}>актуальная</span>
                            : null
                        }
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,flexShrink:0}}>
                    {latestRelease && panelVersion && latestRelease.tag !== panelVersion && (
                      <a href={latestRelease.url} target="_blank" className="btn btn-primary btn-sm" style={{textDecoration:'none'}}>
                        <I.Download/> {latestRelease.tag}
                      </a>
                    )}
                    <a href="https://github.com/MaksimTMB/mtg-adminpanel/releases" target="_blank"
                      className="btn btn-ghost btn-sm" style={{textDecoration:'none'}}>
                      Релизы
                    </a>
                  </div>
                </div>
              </div>

              <div style={{fontSize:11,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>
                MTG прокси на нодах
              </div>
              <table className="ver-table" style={{tableLayout:'fixed',width:'100%'}}>
                <colgroup>
                  <col style={{width:'18%'}}/>
                  <col style={{width:'23%'}}/>
                  <col style={{width:'13%'}}/>
                  <col style={{width:'18%'}}/>
                  <col style={{width:'14%'}}/>
                  <col style={{width:'14%'}}/>
                </colgroup>
                <thead>
                  <tr>
                    <th>Нода</th>
                    <th>Host</th>
                    <th>MTG образ</th>
                    <th>Собран</th>
                    <th>Агент</th>
                    <th style={{textAlign:'right'}}>Обновить</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map(n => {
                    const raw    = versions[n.id];
                    const parsed = raw ? parseVer(raw) : null;
                    const agentV = agentVersions[n.id];
                    const upd    = updating[n.id];
                    return (
                      <tr key={n.id}>
                        <td style={{fontWeight:600,fontSize:13}}>{n.name}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--t3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.host}</td>
                        <td>
                          {checking && !raw
                            ? <span style={{color:'var(--t3)',fontSize:11}}>...</span>
                            : !raw
                              ? <span style={{color:'var(--t3)',fontSize:11}}>—</span>
                              : raw === 'error'
                                ? <span className="badge badge-red">ошибка</span>
                                : <span className="badge badge-blue" style={{fontFamily:'var(--mono)'}}>{parsed.name}</span>
                          }
                        </td>
                        <td style={{fontSize:11,color:'var(--t2)'}}>{parsed?.date || '—'}</td>
                        <td>
                          {checking && agentV === undefined
                            ? <span style={{color:'var(--t3)',fontSize:11}}>...</span>
                            : agentV
                              ? <span className="badge badge-green" style={{fontFamily:'var(--mono)',fontSize:10}}>v{agentV}</span>
                              : n.agent_port
                                ? <span className="badge badge-red" style={{fontSize:10}}>офлайн</span>
                                : <span style={{color:'var(--t3)',fontSize:11}}>—</span>
                          }
                        </td>
                        <td style={{textAlign:'right'}}>
                          <button className="btn btn-ghost btn-sm" onClick={() => updateNode(n)}
                            disabled={upd || !raw || raw === 'error'}
                            title="docker pull — скачать последний патч">
                            {upd ? <><span className="spin spin-sm"/> ...</> : <><I.Download/> pull</>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={checkVersions} disabled={checking}>
                {checking ? <><span className="spin spin-sm"/> Проверяю...</> : <><I.RefreshCw/> Проверить версии</>}
              </button>
              <button className="btn btn-secondary" onClick={updateAllNodes}
                disabled={Object.values(updating).some(Boolean)}>
                <I.Download/> Обновить все ноды
              </button>
              <button className="btn btn-primary" onClick={() => setOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
