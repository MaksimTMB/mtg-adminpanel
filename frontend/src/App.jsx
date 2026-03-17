import { useState, useEffect, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';
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

export default function App() {
  const [authed, setAuthed]           = useState(!!getToken());
  const [page, setPage]               = useState('dashboard');
  const [nodes, setNodes]             = useState([]);
  const [selNode, setSelNode]         = useState(null);
  const [selNodeView, setSelNodeView] = useState(null);
  const [panelVersion, setPanelVersion] = useState(null);
  const toasts = useToast();

  const loadNodes = useCallback(async () => {
    try { const n = await api('GET', '/api/nodes'); setNodes(n || []); } catch {}
  }, []);

  const loadCounts = useCallback(async (list) => {
    try {
      const wc = await Promise.all(list.map(async n => {
        try { const u = await api('GET', `/api/nodes/${n.id}/users`); return {...n, _userCount: u.length}; }
        catch { return {...n, _userCount: 0}; }
      }));
      setNodes(wc);
    } catch {}
  }, []);

  useEffect(() => {
    api('GET', '/api/version')
      .then(r => setPanelVersion(r.version ? (r.version.startsWith('v') ? r.version : `v${r.version}`) : null))
      .catch(() => {});
  }, []);

  useEffect(() => { if (authed) loadNodes(); }, [authed]);
  useEffect(() => { if (nodes.length && !nodes[0]._userCount) loadCounts(nodes); }, [nodes]);

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
            <div key={item.id}
              className={`nav-item ${(page === item.id || (page === 'node' && item.id === 'nodes')) ? 'active' : ''}`}
              onClick={() => nav(item.id)}>
              {item.icon}{item.label}
            </div>
          ))}
        </nav>

        <VersionBlock nodes={nodes} panelVersion={panelVersion}/>

        <div className="sidebar-footer">
          <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'center',marginTop:8}}
            onClick={() => { setToken(''); setAuthed(false); }}>
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
      </nav>

      <Toasts list={toasts}/>
    </div>
  );
}
