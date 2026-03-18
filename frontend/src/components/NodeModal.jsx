import { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import FlagPicker from './FlagPicker.jsx';
import * as I from '../icons.jsx';

export default function NodeModal({ node, onClose, onSave }) {
  const [f, setF] = useState(node || {
    name:'', host:'', ssh_user:'root', ssh_port:22,
    base_dir:'/opt/mtg/users', start_port:4433,
    ssh_password:'', ssh_key:'', flag:null, agent_port:8081,
  });
  const [loading, setLoading]         = useState(false);
  const [auth, setAuth]               = useState(node?.ssh_key ? 'key' : 'password');
  const [agentChecking, setAgentChecking] = useState(false);
  const [agentStatus, setAgentStatus]     = useState(null);
  const [agentUpdating, setAgentUpdating] = useState(false);
  const [showInstall, setShowInstall]     = useState(false);
  const set = (k, v) => setF(x => ({...x, [k]: v}));

  const submit = async () => {
    if (!f.name || !f.host) { toast('Заполни обязательные поля', 'error'); return; }
    setLoading(true);
    try {
      const payload = { ...f,
        ssh_password: auth === 'password' ? f.ssh_password : null,
        ssh_key:      auth === 'key'      ? f.ssh_key      : null,
      };
      if (node) { await api('PUT',  `/api/nodes/${node.id}`, payload); toast('Нода обновлена', 'success'); }
      else      { await api('POST', '/api/nodes', payload);            toast('Нода добавлена', 'success'); }
      onSave();
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const checkAgent = async () => {
    if (!node?.id) return;
    setAgentChecking(true);
    try {
      const r = await api('GET', `/api/nodes/${node.id}/check-agent`);
      setAgentStatus(r.available);
      toast(r.available ? 'Агент доступен ✓' : 'Агент недоступен', r.available ? 'success' : 'error');
    } catch { setAgentStatus(false); }
    finally { setAgentChecking(false); }
  };

  const updateAgent = async () => {
    if (!node?.id) return;
    setAgentUpdating(true);
    toast('Обновление агента...', 'info');
    try {
      const r = await api('POST', `/api/nodes/${node.id}/update-agent`);
      if (r.ok) toast('Агент обновлён ✓', 'success');
      else toast('Ошибка: ' + (r.error || r.output), 'error');
      setAgentStatus(null);
    } catch(e) { toast('Ошибка: ' + e.message, 'error'); }
    finally { setAgentUpdating(false); }
  };

  const installCmd = `mkdir -p /opt/mtg-agent && cd /opt/mtg-agent && curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/dev/mtg-agent/install-agent.sh | bash`;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-head">
          <div className="modal-title">{node ? <><I.Edit/> Редактировать ноду</> : <><I.Plus/> Добавить ноду</>}</div>
          <button className="modal-close" onClick={onClose}><I.X/></button>
        </div>
        <div className="modal-body">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group" style={{gridColumn:'1/-1'}}>
              <label className="form-label">Название *</label>
              <input className="form-input" placeholder="Helsinki" value={f.name}
                onChange={e => set('name', e.target.value)} autoFocus/>
            </div>
            <div className="form-group" style={{gridColumn:'1/-1'}}>
              <label className="form-label">Host / IP *</label>
              <input className="form-input" placeholder="hel.maks68.com" value={f.host}
                onChange={e => set('host', e.target.value)}/>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Флаг страны</label>
            <FlagPicker value={f.flag} onChange={v => set('flag', v)}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group"><label className="form-label">SSH Пользователь</label>
              <input className="form-input" placeholder="root" value={f.ssh_user} onChange={e => set('ssh_user', e.target.value)}/></div>
            <div className="form-group"><label className="form-label">SSH Порт</label>
              <input className="form-input" type="number" placeholder="22" value={f.ssh_port} onChange={e => set('ssh_port', parseInt(e.target.value))}/></div>
            <div className="form-group"><label className="form-label">Рабочий каталог</label>
              <input className="form-input" placeholder="/opt/mtg/users" value={f.base_dir} onChange={e => set('base_dir', e.target.value)}/></div>
            <div className="form-group"><label className="form-label">Начальный порт</label>
              <input className="form-input" type="number" placeholder="4433" value={f.start_port} onChange={e => set('start_port', parseInt(e.target.value))}/></div>
          </div>
          <div className="form-group">
            <label className="form-label">SSH Авторизация</label>
            <div className="radio-group">
              <div className={`radio-btn ${auth === 'password' ? 'on' : ''}`} onClick={() => setAuth('password')}><I.Key/> Пароль</div>
              <div className={`radio-btn ${auth === 'key' ? 'on' : ''}`} onClick={() => setAuth('key')}><I.Lock/> SSH ключ</div>
            </div>
          </div>
          {auth === 'password'
            ? <div className="form-group"><label className="form-label">Пароль</label>
                <input className="form-input" type="password" placeholder="••••••••"
                  value={f.ssh_password || ''} onChange={e => set('ssh_password', e.target.value)}/></div>
            : <div className="form-group"><label className="form-label">Приватный ключ</label>
                <textarea className="form-input" rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  value={f.ssh_key || ''} onChange={e => set('ssh_key', e.target.value)}
                  style={{fontFamily:'var(--mono)',fontSize:11,resize:'vertical'}}/></div>
          }

          {/* Agent section */}
          <div style={{borderTop:'1px solid var(--b1)',paddingTop:16,marginTop:4}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:8}}>
                <I.Activity/> MTG Agent
                {agentStatus === true  && <span className="badge badge-green" style={{fontSize:10}}>доступен</span>}
                {agentStatus === false && <span className="badge badge-red"   style={{fontSize:10}}>недоступен</span>}
                {node?.agent_port && agentStatus === null && <span className="badge badge-purple" style={{fontSize:10}}>порт {node.agent_port}</span>}
              </div>
              <div style={{display:'flex',gap:8}}>
                {node && <button className="btn btn-ghost btn-sm" onClick={checkAgent} disabled={agentChecking}>
                  {agentChecking ? <><span className="spin spin-sm"/> проверка</> : <><I.Wifi/> Проверить</>}
                </button>}
                {node && <button className="btn btn-secondary btn-sm" onClick={updateAgent} disabled={agentUpdating}>
                  {agentUpdating ? <><span className="spin spin-sm"/> обновление...</> : <><I.RefreshCw/> Обновить</>}
                </button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setShowInstall(!showInstall)}>
                  <I.Download/> Установить
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Порт агента (оставь пустым если не установлен)</label>
              <input className="form-input" type="number" placeholder="8081" value={f.agent_port || ''}
                onChange={e => set('agent_port', e.target.value ? parseInt(e.target.value) : null)}/>
            </div>
            {showInstall && (
              <div style={{background:'var(--bg3)',borderRadius:10,padding:14,border:'1px solid var(--b1)'}}>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:8}}>Выполни на ноде {f.host}:</div>
                <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                  <code style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--cy)',flex:1,wordBreak:'break-all',
                    lineHeight:1.6,background:'var(--bg)',padding:'8px 10px',borderRadius:7,border:'1px solid var(--b1)'}}>
                    {installCmd}
                  </code>
                  <button className="btn btn-ghost btn-sm" style={{flexShrink:0}}
                    onClick={() => navigator.clipboard.writeText(installCmd).then(() => toast('Скопировано!','success'))}>
                    <I.Copy/>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? <span className="spin spin-sm"/> : <><I.Check/> {node ? 'Сохранить' : 'Добавить'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
