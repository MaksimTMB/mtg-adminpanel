import { useState, useEffect, useCallback } from 'react';
import { api, getToken, setToken, setTotpCode, setTotpRequiredHandler } from './api.js';
import { useToast, Toasts } from './toast.jsx';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import NodesPage from './components/NodesPage.jsx';
import NodePage from './components/NodePage.jsx';
import UsersPage from './components/UsersPage.jsx';
import AllUsers from './components/AllUsers.jsx';
import Settings from './components/Settings.jsx';
import VersionBlock from './components/VersionBlock.jsx';
import * as I from './icons.jsx';

// ── Inline TOTP re-auth overlay ──────────────────────────
function TotpOverlay({ onDone }) {
  const [code, setCode] = useState('');
  const [err,  setErr]  = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (code.length !== 6) return;
    setTotpCode(code);
    try {
      await api('GET', '/api/nodes');
      onDone();
    } catch {
      setTotpCode('');
      setCode('');
      setErr(true);
    }
  };

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999
    }}>
      <div className="login-card" style={{margin:0}}>
        <div className="login-head">
          <div className="login-icon"><I.Shield/></div>
          <div className="login-title">Требуется 2FA</div>
          <div className="login-sub">Сессия требует подтверждения</div>
        </div>
        <div className="login-body">
          <form onSubmit={submit}>
            <p style={{fontSize:13,color:'var(--t2)',textAlign:'center',marginBottom:18,lineHeight:1.6}}>
              Введи текущий код из приложения<br/>аутентификатора
            </p>
            <div className="form-group">
              <input className="form-input totp-code-input" type="text" inputMode="numeric"
                placeholder="——————" value={code} maxLength={6}
                onChange={e => { setCode(e.target.value.replace(/\D/g,'')); setErr(false); }}
                autoFocus/>
              {err && <div style={{color:'var(--re)',fontSize:12,marginTop:6}}>Неверный код</div>}
            </div>
            <button className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:10}}
              type="submit" disabled={code.length !== 6}>
              <I.Check/> Подтвердить
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed]           = useState(!!getToken());
  const [page, setPage]               = useState('dashboard');
  const [nodes, setNodes]             = useState([]);
  const [selNode, setSelNode]         = useState(null);
  const [selNodeView, setSelNodeView] = useState(null);
  const [panelVersion, setPanelVersion] = useState(null);
  const [totpNeeded, setTotpNeeded]   = useState(false);
  const toasts = useToast();

  // Register global TOTP-required handler
  useEffect(() => {
    setTotpRequiredHandler(() => setTotpNeeded(true));
    return () => setTotpRequiredHandler(null);
  }, []);

  const loadNodes = useCallback(async () => {
    try { const n = await api('GET', '/api/nodes'); setNodes(n || []); } catch {}
  }, []);

  const loadCounts = useCallback(async (list) => {
    try {
      // DB-only endpoint — no SSH/agent calls, instant response
      const counts = await api('GET', '/api/nodes/counts');
      setNodes(list.map(n => ({ ...n, _userCount: counts[n.id] || 0 })));
    } catch {}
  }, []);

  useEffect(() => {
    api('GET', '/api/version')
      .then(r => setPanelVersion(r.version ? (r.version.startsWith('v') ? r.version : `v${r.version}`) : null))
      .catch(() => {});
  }, []);

  useEffect(() => { if (authed) loadNodes(); }, [authed]);
  useEffect(() => { if (nodes.length) loadCounts(nodes); }, [nodes.length]);

  const nav = (p) => { setPage(p); setSelNode(null); setSelNodeView(null); };
  const selectNode   = (n) => { setSelNode(n); setPage('users'); };
  const openNodeView = (n) => { setSelNodeView(n); setPage('node'); };

  const NAV = [
    { id: 'dashboard', icon: <I.LayoutDash/>, label: 'Дашборд' },
    { id: 'nodes',     icon: <I.Server/>,     label: 'Ноды' },
    { id: 'users',     icon: <I.Users/>,      label: 'Клиенты' },
    { id: 'settings',  icon: <I.Settings/>,   label: 'Настройки' },
  ];

  if (!authed) return (
    <>
      <Login onLogin={t => { setToken(t); setAuthed(true); }}/>
      <Toasts list={toasts}/>
    </>
  );

  return (
    <div className="app">
      {totpNeeded && (
        <TotpOverlay onDone={() => { setTotpNeeded(false); loadNodes(); }}/>
      )}

      <aside className="sidebar" id="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><I.Zap/></div>
          <div className="logo-texts">
            <div className="logo-name">MTG Panel</div>
            <div className="logo-sub">{panelVersion || 'adminpanel'}</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-section">Навигация</div>
          {NAV.map(item => (
            <div
              key={item.id}
              className={`nav-item ${(page === item.id || (page === 'node' && item.id === 'nodes') || (page === 'users' && selNode && item.id === 'nodes')) ? 'active' : ''}`}
              onClick={() => nav(item.id)}>
              {item.icon}{item.label}
            </div>
          ))}
        </nav>

        <VersionBlock nodes={nodes} panelVersion={panelVersion}/>

        <div className="sidebar-footer">
          <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'center',marginTop:8}}
            onClick={() => { setToken(''); setTotpCode(''); setAuthed(false); }}>
            <I.LogOut/> Выйти
          </button>
        </div>
      </aside>

      <main className="main">
        {page === 'dashboard' && <Dashboard nodes={nodes} onSelectNode={openNodeView} onManageNode={selectNode}/>}
        {page === 'nodes'     && <NodesPage nodes={nodes} onReload={loadNodes} onManage={selectNode} onOpenNode={openNodeView}/>}
        {page === 'node'      && selNodeView && (
          <NodePage node={selNodeView}
            onBack={() => { setPage('nodes'); setSelNodeView(null); }}
            onManage={selectNode}
            onReload={loadNodes}/>
        )}
        {page === 'users' && !selNode && <AllUsers nodes={nodes} onSelectNode={selectNode}/>}
        {page === 'users' && selNode  && (
          <UsersPage node={selNode} onBack={() => { setSelNode(null); setPage('users'); }}/>
        )}
        {page === 'settings' && <Settings/>}
      </main>

      <nav className="mobile-bar">
        {NAV.map(item => (
          <div key={item.id} className={`mob-item ${page === item.id ? 'active' : ''}`} onClick={() => nav(item.id)}>
            {item.icon}<span className="mob-label">{item.label}</span>
          </div>
        ))}
        <div className="mob-item mob-logout" onClick={() => { setToken(''); setTotpCode(''); setAuthed(false); }}>
          <I.LogOut/><span className="mob-label">Выйти</span>
        </div>
      </nav>

      <Toasts list={toasts}/>
    </div>
  );
}
