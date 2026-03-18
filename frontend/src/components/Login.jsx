import { useState } from 'react';
import { setToken, setTotpCode } from '../api.js';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import * as I from '../icons.jsx';

export default function Login({ onLogin }) {
  const [tok, setTok]     = useState('');
  const [step, setStep]   = useState('token');
  const [totp, setTotp]   = useState('');
  const [loading, setLoading] = useState(false);

  const submitToken = async e => {
    e.preventDefault();
    if (!tok.trim()) return;
    setLoading(true);
    try {
      setToken(tok);
      const s = await fetch('/api/totp/status', { headers: { 'x-auth-token': tok } }).then(r => r.json());
      if (s.enabled) { setStep('totp'); }
      else { await api('GET', '/api/nodes'); toast('Вход выполнен', 'success'); onLogin(tok); }
    } catch { setToken(''); toast('Неверный токен', 'error'); }
    finally { setLoading(false); }
  };

  const submitTotp = async e => {
    e.preventDefault();
    if (totp.length !== 6) return;
    setLoading(true);
    try {
      setTotpCode(totp);
      await api('GET', '/api/nodes');
      toast('Вход выполнен', 'success');
      onLogin(tok);
    } catch {
      setTotpCode('');
      setTotp('');
      toast('Неверный код 2FA', 'error');
    }
    finally { setLoading(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <div className="login-icon">{step === 'totp' ? <I.Shield/> : <I.Zap/>}</div>
          <div className="login-title">MTG Panel</div>
          <div className="login-sub">{step === 'totp' ? 'двухфакторная аутентификация' : 'управление прокси'}</div>
        </div>
        <div className="login-body">
          {step === 'token' ? (
            <form onSubmit={submitToken}>
              <div className="form-group">
                <label className="form-label">Пароль</label>
                <input className="form-input" type="password" placeholder="Введи пароль..."
                  value={tok} onChange={e => setTok(e.target.value)} autoFocus/>
              </div>
              <button className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:10}} type="submit" disabled={loading}>
                {loading ? <span className="spin spin-sm"/> : <><I.Zap/> Войти</>}
              </button>
            </form>
          ) : (
            <form onSubmit={submitTotp}>
              <p style={{fontSize:13,color:'var(--t2)',textAlign:'center',marginBottom:18,lineHeight:1.6}}>
                Открой приложение аутентификатора и введи<br/>текущий 6-значный код
              </p>
              <div className="form-group">
                <input className="form-input totp-code-input" type="text" inputMode="numeric"
                  placeholder="——————" value={totp} maxLength={6}
                  onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-ghost" style={{flex:1,justifyContent:'center'}} type="button"
                  onClick={() => { setStep('token'); setToken(''); setTotp(''); }}>
                  <I.ArrowLeft/> Назад
                </button>
                <button className="btn btn-primary" style={{flex:1.5,justifyContent:'center'}} type="submit"
                  disabled={loading || totp.length !== 6}>
                  {loading ? <span className="spin spin-sm"/> : <><I.Check/> Подтвердить</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
