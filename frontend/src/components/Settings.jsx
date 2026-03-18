import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { setTotpCode } from '../api.js';
import * as I from '../icons.jsx';

export default function Settings() {
  const [enabled, setEnabled] = useState(false);
  const [data, setData]       = useState(null);
  const [verify, setVerify]   = useState('');
  const [disable, setDisable] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep]       = useState('idle');

  useEffect(() => {
    api('GET', '/api/totp/status').then(r => setEnabled(r.enabled)).catch(() => {});
  }, []);

  const startSetup = async () => {
    setLoading(true);
    try { const d = await api('POST', '/api/totp/setup'); setData(d); setStep('setup'); }
    catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const confirmEnable = async () => {
    if (verify.length !== 6) return;
    setLoading(true);
    try {
      await api('POST', '/api/totp/verify', {code: verify});
      // Save current code immediately so session stays authenticated
      setTotpCode(verify);
      toast('2FA включена!', 'success');
      setEnabled(true); setStep('idle'); setData(null); setVerify('');
    } catch { toast('Неверный код', 'error'); }
    finally { setLoading(false); }
  };

  const confirmDisable = async () => {
    if (disable.length !== 6) return;
    setLoading(true);
    try {
      await api('POST', '/api/totp/disable', {code: disable});
      toast('2FA отключена', 'success');
      setEnabled(false); setStep('idle'); setDisable(''); setTotpCode('');
    } catch { toast('Неверный код', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title"><em>Настройки</em></div>
        </div>
      </div>

      <div className="card" style={{maxWidth:520}}>
        <div className="card-header">
          <div className="card-title"><I.Shield/> Двухфакторная аутентификация</div>
          <span className={`badge ${enabled ? 'badge-green' : 'badge-red'}`}>
            <span className={`dot ${enabled ? 'dot-live' : ''}`}/>{enabled ? 'включена' : 'выключена'}
          </span>
        </div>

        <p style={{fontSize:13,color:'var(--t3)',marginBottom:18}}>
          Google Authenticator, Aegis, Authy или любое TOTP-приложение
        </p>

        {step === 'idle' && (!enabled
          ? <button className="btn btn-primary" onClick={startSetup} disabled={loading}>
              {loading ? <span className="spin spin-sm"/> : <><I.Shield/> Включить 2FA</>}
            </button>
          : <button className="btn btn-danger" onClick={() => setStep('disable')}><I.X/> Отключить 2FA</button>
        )}

        {step === 'setup' && data && (
          <div>
            <div style={{background:'var(--bg3)',border:'1px solid var(--b1)',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:12,color:'var(--t2)',lineHeight:1.9}}>
              1. Открой приложение аутентификатора<br/>
              2. Нажми "+" → "Сканировать QR-код"<br/>
              3. Введи 6-значный код для подтверждения
            </div>
            <div style={{textAlign:'center',marginBottom:16}}>
              <div style={{display:'inline-block',padding:16,background:'#fff',borderRadius:12}}>
                <QRCodeSVG value={data.qr} size={200} level="M"/>
              </div>
            </div>
            <div style={{background:'var(--bg3)',border:'1px solid var(--b1)',borderRadius:9,padding:'10px 14px',marginBottom:16,fontFamily:'var(--mono)',fontSize:12,color:'var(--cy)',wordBreak:'break-all',textAlign:'center'}}>
              <div style={{fontSize:10,color:'var(--t3)',marginBottom:4}}>Секрет (если QR не работает):</div>
              {data.secret}
            </div>
            <div className="form-group">
              <label className="form-label">Код подтверждения</label>
              <input className="form-input totp-code-input" type="text" inputMode="numeric" placeholder="——————"
                value={verify} maxLength={6} onChange={e => setVerify(e.target.value.replace(/\D/g, ''))} autoFocus/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={() => { setStep('idle'); setData(null); }}>Отмена</button>
              <button className="btn btn-primary" onClick={confirmEnable} disabled={loading || verify.length !== 6}
                style={{flex:1,justifyContent:'center'}}>
                {loading ? <span className="spin spin-sm"/> : <><I.Check/> Подтвердить и включить</>}
              </button>
            </div>
          </div>
        )}

        {step === 'disable' && (
          <div>
            <div style={{background:'rgba(251,113,133,0.05)',border:'1px solid rgba(251,113,133,0.15)',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:13,color:'var(--re)'}}>
              Введи текущий код из приложения для отключения 2FA
            </div>
            <div className="form-group">
              <label className="form-label">Код из приложения</label>
              <input className="form-input totp-code-input" type="text" inputMode="numeric" placeholder="——————"
                value={disable} maxLength={6} onChange={e => setDisable(e.target.value.replace(/\D/g, ''))} autoFocus/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={() => setStep('idle')}>Отмена</button>
              <button className="btn btn-danger" onClick={confirmDisable} disabled={loading || disable.length !== 6}
                style={{flex:1,justifyContent:'center'}}>
                {loading ? <span className="spin spin-sm"/> : <><I.X/> Отключить 2FA</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
