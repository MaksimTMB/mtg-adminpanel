import { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import * as I from '../icons.jsx';

export default function AddUserModal({ nodeId, onClose, onSave }) {
  const [f, setF] = useState({ name:'', note:'', expires_at:'', traffic_limit_gb:'' });
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setF(x => ({...x, [k]: v}));

  const submit = async () => {
    if (!f.name.trim()) { toast('Введи имя', 'error'); return; }
    if (f.name.length > 32) { toast('Имя не может быть длиннее 32 символов', 'error'); return; }
    setLoading(true);
    try {
      const u = await api('POST', `/api/nodes/${nodeId}/users`, {
        name: f.name.trim(),
        note: f.note || '',
        expires_at: f.expires_at || null,
        traffic_limit_gb: f.traffic_limit_gb ? parseFloat(f.traffic_limit_gb) : null,
      });
      toast(`Юзер ${u.name} создан`, 'success');
      onSave(u);
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-head">
          <div className="modal-title"><I.Plus/> Добавить юзера</div>
          <button className="modal-close" onClick={onClose}><I.X/></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Имя * (латиница)</label>
            <input className="form-input" placeholder="ivan" value={f.name}
              onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              onKeyDown={e => e.key === 'Enter' && submit()} autoFocus/>
          </div>
          <div className="form-group">
            <label className="form-label">Заметка</label>
            <input className="form-input" placeholder="Иван, оплатил до 01.04" value={f.note}
              onChange={e => set('note', e.target.value)}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group">
              <label className="form-label">Истекает</label>
              <input className="form-input" type="datetime-local" value={f.expires_at}
                onChange={e => set('expires_at', e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="form-label">Лимит трафика (ГБ)</label>
              <input className="form-input" type="number" placeholder="∞" min="0" step="0.1"
                value={f.traffic_limit_gb} onChange={e => set('traffic_limit_gb', e.target.value)}/>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? <span className="spin spin-sm"/> : <><I.Check/> Создать</>}
          </button>
        </div>
      </div>
    </div>
  );
}
