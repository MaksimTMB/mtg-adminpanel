import { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import * as I from '../icons.jsx';

const INTERVALS = [
  { v: 'never',   label: 'Не сбрасывать' },
  { v: 'daily',   label: 'Каждый день' },
  { v: 'monthly', label: 'Каждый месяц' },
  { v: 'yearly',  label: 'Каждый год' },
];

function fmtBytes(b) {
  if (!b) return '0';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + 'GB';
  if (b >= 1048576)    return (b / 1048576).toFixed(2) + 'MB';
  if (b >= 1024)       return (b / 1024).toFixed(2) + 'KB';
  return b + 'B';
}

export default function EditModal({ user, nodeId, onClose, onSave }) {
  const [f, setF] = useState({
    note: user.note || '',
    expires_at: user.expires_at ? user.expires_at.replace(' ', 'T').slice(0, 16) : '',
    traffic_limit_gb: user.traffic_limit_gb || '',
    max_devices: user.max_devices || '',
    traffic_reset_interval: user.traffic_reset_interval || 'never',
  });
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setF(x => ({...x, [k]: v}));

  const submit = async () => {
    setLoading(true);
    try {
      await api('PUT', `/api/nodes/${nodeId}/users/${user.name}`, {
        note: f.note,
        expires_at: f.expires_at || null,
        traffic_limit_gb: f.traffic_limit_gb ? parseFloat(f.traffic_limit_gb) : null,
        max_devices: f.max_devices ? parseInt(f.max_devices) : null,
        traffic_reset_interval: f.traffic_reset_interval !== 'never' ? f.traffic_reset_interval : null,
      });
      toast('Сохранено', 'success');
      onSave();
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:460}}>
        <div className="modal-head">
          <div className="modal-title"><I.Edit/> Настройки — {user.name}</div>
          <button className="modal-close" onClick={onClose}><I.X/></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Заметка</label>
            <input className="form-input" placeholder="Иван, оплатил до 01.04" value={f.note}
              onChange={e => set('note', e.target.value)} autoFocus/>
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

          <div style={{borderTop:'1px solid var(--b1)',paddingTop:14,marginTop:4}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
              <span style={{width:16,height:16,display:'inline-flex',flexShrink:0}}><I.Wifi/></span>
              Ограничения устройств
            </div>
            <div className="form-group">
              <label className="form-label">Макс. одновременных устройств</label>
              <input className="form-input" type="number" placeholder="∞ (без ограничений)"
                min="1" step="1" value={f.max_devices}
                onChange={e => set('max_devices', e.target.value)}/>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:5}}>При превышении прокси автоматически остановится</div>
            </div>
          </div>

          <div style={{borderTop:'1px solid var(--b1)',paddingTop:14,marginTop:4}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
              <span style={{width:16,height:16,display:'inline-flex',flexShrink:0}}><I.RefreshCw/></span>
              Автосброс трафика
            </div>
            <div className="form-group">
              <label className="form-label">Интервал сброса</label>
              <div className="radio-group" style={{flexWrap:'wrap'}}>
                {INTERVALS.map(i => (
                  <div key={i.v} className={`radio-btn ${f.traffic_reset_interval === i.v ? 'on' : ''}`}
                    onClick={() => set('traffic_reset_interval', i.v)}>
                    {i.label}
                  </div>
                ))}
              </div>
            </div>
            {user.next_reset_at && (
              <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>
                Следующий сброс: <span style={{color:'var(--t2)'}}>{new Date(user.next_reset_at).toLocaleString('ru-RU')}</span>
              </div>
            )}
          </div>

          {(user.total_traffic_rx_bytes > 0 || user.total_traffic_tx_bytes > 0) && (
            <div style={{borderTop:'1px solid var(--b1)',paddingTop:14,marginTop:4}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:16,height:16,display:'inline-flex',flexShrink:0}}><I.Activity/></span>
                Накопленный трафик
              </div>
              <div style={{display:'flex',gap:16}}>
                <div style={{background:'var(--bg3)',borderRadius:8,padding:'8px 14px',flex:1,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'var(--t3)',marginBottom:3}}>Получено</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--cy)'}}>{fmtBytes(user.total_traffic_rx_bytes)}</div>
                </div>
                <div style={{background:'var(--bg3)',borderRadius:8,padding:'8px 14px',flex:1,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'var(--t3)',marginBottom:3}}>Отправлено</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--gr)'}}>{fmtBytes(user.total_traffic_tx_bytes)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? <span className="spin spin-sm"/> : <><I.Check/> Сохранить</>}
          </button>
        </div>
      </div>
    </div>
  );
}
