import { useState } from 'react';
import { setToken, setTotpCode, setTotpSession, clearTotpAuth } from '../api.js';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { useAppCtx } from '../AppContext.jsx';
import * as I from '../icons.jsx';

export default function Login({ onLogin }) {
  const { t } = useAppCtx();
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
      clearTotpAuth();
      const s = await fetch('/api/totp/status', { headers: { 'x-auth-token': tok } }).then(r => r.json());
      if (s.enabled) { setStep('totp'); }
      else { await api('GET', '/api/nodes'); toast(t.loginSuccess, 'success'); onLogin(tok); }
    } catch { setToken(''); toast(t.loginWrongToken, 'error'); }
    finally { setLoading(false); }
  };

  const submitTotp = async e => {
    e.preventDefault();
    if (totp.length !== 6) return;
    setLoading(true);
    try {
      setTotpCode(totp);
      const r = await fetch('/api/totp/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': tok },
        body: JSON.stringify({ code: totp }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.session) throw new Error(data.error || 'TOTP session failed');
      setTotpSession(data.session);
      setTotpCode('');
      await api('GET', '/api/nodes');
      toast(t.loginSuccess, 'success');
      onLogin(tok);
    } catch {
      clearTotpAuth();
      setTotp('');
      toast(t.loginWrong2FA, 'error');
    }
    finally { setLoading(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <div className="login-icon">{step === 'totp' ? <I.Shield/> : <I.Zap/>}</div>
          <div className="login-title">MTG Panel</div>
          <div className="login-sub">{step === 'totp' ? t.loginTotpSub : t.loginSub}</div>
        </div>
        <div className="login-body">
          {step === 'token' ? (
            <form onSubmit={submitToken}>
              <div className="form-group">
                <label className="form-label">{t.passwordLabel}</label>
                <input className="form-input" type="password" placeholder={t.loginTokenPlaceholder}
                  value={tok} onChange={e => setTok(e.target.value)} autoFocus/>
              </div>
              <button className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:10}} type="submit" disabled={loading}>
                {loading ? <span className="spin spin-sm"/> : <><I.Zap/> {t.loginBtn}</>}
              </button>
            </form>
          ) : (
            <form onSubmit={submitTotp}>
              <p style={{fontSize:13,color:'var(--t2)',textAlign:'center',marginBottom:18,lineHeight:1.6}}>
                {t.login2FAHint.split('\n').map((l,i) => <span key={i}>{l}{i===0&&<br/>}</span>)}
              </p>
              <div className="form-group">
                <input className="form-input totp-code-input" type="text" inputMode="numeric"
                  placeholder="——————" value={totp} maxLength={6}
                  onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-ghost" style={{flex:1,justifyContent:'center'}} type="button"
                  onClick={() => { setStep('token'); setToken(''); setTotp(''); }}>
                  <I.ArrowLeft/> {t.loginBack}
                </button>
                <button className="btn btn-primary" style={{flex:1.5,justifyContent:'center'}} type="submit"
                  disabled={loading || totp.length !== 6}>
                  {loading ? <span className="spin spin-sm"/> : <><I.Check/> {t.loginConfirm}</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
