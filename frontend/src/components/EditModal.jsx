import { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { useAppCtx } from '../AppContext.jsx';
import * as I from '../icons.jsx';

function fmtBytes(b) {
  if (!b) return '0';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + 'GB';
  if (b >= 1048576)    return (b / 1048576).toFixed(2) + 'MB';
  if (b >= 1024)       return (b / 1024).toFixed(2) + 'KB';
  return b + 'B';
}

export default function EditModal({ user, nodeId, onClose, onSave }) {
  const { t } = useAppCtx();
  const INTERVALS = [
    { v: 'never',   label: t.intervalNever },
    { v: 'daily',   label: t.intervalDaily },
    { v: 'monthly', label: t.intervalMonthly },
    { v: 'yearly',  label: t.intervalYearly },
  ];

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
      toast(t.saved, 'success');
      onSave();
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:460}}>
        <div className="modal-head">
          <div className="modal-title"><I.Edit/> {t.editClientTitle(user.name)}</div>
          <button className="modal-close" onClick={onClose}><I.X/></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t.clientNoteLabel}</label>
            <input className="form-input" placeholder={t.clientNotePlaceholder} value={f.note}
              onChange={e => set('note', e.target.value)} autoFocus/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="form-group">
              <label className="form-label">{t.expiryLabel}</label>
              <input className="form-input" type="datetime-local" value={f.expires_at}
                onChange={e => set('expires_at', e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="form-label">{t.trafficLimitLabel}</label>
              <input className="form-input" type="number" placeholder="∞" min="0" step="0.1"
                value={f.traffic_limit_gb} onChange={e => set('traffic_limit_gb', e.target.value)}/>
            </div>
          </div>

          <div style={{borderTop:'1px solid var(--b1)',paddingTop:14,marginTop:4}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
              <span style={{width:16,height:16,display:'inline-flex',flexShrink:0}}><I.Wifi/></span>
              {t.devicesSectionTitle}
            </div>
            <div className="form-group">
              <label className="form-label">{t.maxDevicesLabel}</label>
              <input className="form-input" type="number" placeholder="∞"
                min="1" step="1" value={f.max_devices}
                onChange={e => set('max_devices', e.target.value)}/>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:5}}>{t.maxDevicesHint}</div>
            </div>
          </div>

          <div style={{borderTop:'1px solid var(--b1)',paddingTop:14,marginTop:4}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
              <span style={{width:16,height:16,display:'inline-flex',flexShrink:0}}><I.RefreshCw/></span>
              {t.trafficResetSection}
            </div>
            <div className="form-group">
              <label className="form-label">{t.intervalLabel}</label>
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
                {t.nextReset} <span style={{color:'var(--t2)'}}>{new Date(user.next_reset_at).toLocaleString(t.dateLocale)}</span>
              </div>
            )}
          </div>

          {(user.total_traffic_rx_bytes > 0 || user.total_traffic_tx_bytes > 0) && (
            <div style={{borderTop:'1px solid var(--b1)',paddingTop:14,marginTop:4}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:16,height:16,display:'inline-flex',flexShrink:0}}><I.Activity/></span>
                {t.lifetimeSection}
              </div>
              <div style={{display:'flex',gap:16}}>
                <div style={{background:'var(--bg3)',borderRadius:8,padding:'8px 14px',flex:1,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'var(--t3)',marginBottom:3}}>{t.received}</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--cy)'}}>{fmtBytes(user.total_traffic_rx_bytes)}</div>
                </div>
                <div style={{background:'var(--bg3)',borderRadius:8,padding:'8px 14px',flex:1,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'var(--t3)',marginBottom:3}}>{t.sent}</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--gr)'}}>{fmtBytes(user.total_traffic_tx_bytes)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? <span className="spin spin-sm"/> : <><I.Check/> {t.save}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
