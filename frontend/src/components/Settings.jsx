import { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';
import { toast } from '../toast.jsx';
import { setTotpCode } from '../api.js';
import { useAppCtx } from '../AppContext.jsx';
import * as I from '../icons.jsx';

export default function Settings() {
  const { t, lang, setLang, theme, setTheme, logo, setLogo, fetchLogo } = useAppCtx();

  // ── 2FA ───────────────────────────────────────────────
  const [enabled,  setEnabled]  = useState(false);
  const [data,     setData]     = useState(null);
  const [verify,   setVerify]   = useState('');
  const [disable,  setDisable]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [step,     setStep]     = useState('idle');
  const [logoLoading, setLogoLoading] = useState(false);
  const fileRef = useRef();

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
      await api('POST', '/api/totp/verify', { code: verify });
      setTotpCode(verify);
      toast(t.twoFAEnabledToast, 'success');
      setEnabled(true); setStep('idle'); setData(null); setVerify('');
    } catch { toast(t.wrongCode, 'error'); }
    finally { setLoading(false); }
  };

  const confirmDisable = async () => {
    if (disable.length !== 6) return;
    setLoading(true);
    try {
      await api('POST', '/api/totp/disable', { code: disable });
      toast(t.twoFADisabledToast, 'success');
      setEnabled(false); setStep('idle'); setDisable(''); setTotpCode('');
    } catch { toast(t.wrongCode, 'error'); }
    finally { setLoading(false); }
  };

  // ── Logo ───────────────────────────────────────────────
  const handleLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Max 2 MB', 'error'); return; }
    setLogoLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        await api('POST', '/api/settings/logo', { data: ev.target.result });
        await fetchLogo();
        toast(t.logoUploaded, 'success');
      } catch(err) { toast(err.message, 'error'); }
      finally { setLogoLoading(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeLogo = async () => {
    setLogoLoading(true);
    try {
      await api('DELETE', '/api/settings/logo');
      setLogo(null);
      toast(t.logoRemoved, 'success');
    } catch(e) { toast(e.message, 'error'); }
    finally { setLogoLoading(false); }
  };

  return (
    <div className="pg">
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title"><em>{t.settingsTitle}</em></div>
        </div>
      </div>

      {/* ── Appearance ──────────────────────────────────── */}
      <div className="card" style={{maxWidth:520,marginBottom:16}}>
        <div className="card-header">
          <div className="card-title"><I.Sun/> {t.appearance}</div>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:10}}>
            {t.themeLabel}
          </div>
          <div className="radio-group">
            <div className={`radio-btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>
              <I.Moon/> {t.themeDark}
            </div>
            <div className={`radio-btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>
              <I.Sun/> {t.themeLight}
            </div>
          </div>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:10}}>
            {t.languageLabel}
          </div>
          <div className="radio-group">
            <div className={`radio-btn ${lang === 'ru' ? 'on' : ''}`} onClick={() => setLang('ru')}>
              <I.Globe/> Русский
            </div>
            <div className={`radio-btn ${lang === 'en' ? 'on' : ''}`} onClick={() => setLang('en')}>
              <I.Globe/> English
            </div>
          </div>
        </div>

        <div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:10}}>
            {t.logoLabel}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            {logo
              ? <img src={logo} alt="logo" style={{width:48,height:48,objectFit:'contain',borderRadius:10,border:'1px solid var(--b2)',background:'var(--bg3)'}}/>
              : <div style={{width:48,height:48,borderRadius:10,border:'1px dashed var(--b3)',background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--t3)'}}>
                  <I.Image/>
                </div>
            }
            <div style={{flex:1}}>
              <div style={{display:'flex',gap:8,marginBottom:6}}>
                <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={logoLoading}>
                  {logoLoading ? <span className="spin spin-sm"/> : <><I.Download/> {t.logoUpload}</>}
                </button>
                {logo && (
                  <button className="btn btn-ghost btn-sm" onClick={removeLogo} disabled={logoLoading}>
                    <I.Trash/> {t.logoRemove}
                  </button>
                )}
              </div>
              <div style={{fontSize:11,color:'var(--t3)'}}>{t.logoHint}</div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleLogoFile}/>
        </div>
      </div>

      {/* ── 2FA ─────────────────────────────────────────── */}
      <div className="card" style={{maxWidth:520}}>
        <div className="card-header">
          <div className="card-title"><I.Shield/> {t.twoFATitle}</div>
          <span className={`badge ${enabled ? 'badge-green' : 'badge-red'}`}>
            <span className={`dot ${enabled ? 'dot-live' : ''}`}/>{enabled ? t.twoFAEnabled : t.twoFADisabled}
          </span>
        </div>

        <p style={{fontSize:13,color:'var(--t3)',marginBottom:18}}>{t.twoFAApps}</p>

        {step === 'idle' && (!enabled
          ? <button className="btn btn-primary" onClick={startSetup} disabled={loading}>
              {loading ? <span className="spin spin-sm"/> : <><I.Shield/> {t.enableTwoFA}</>}
            </button>
          : <button className="btn btn-danger" onClick={() => setStep('disable')}><I.X/> {t.disableTwoFA}</button>
        )}

        {step === 'setup' && data && (
          <div>
            <div style={{background:'var(--bg3)',border:'1px solid var(--b1)',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:12,color:'var(--t2)',lineHeight:1.9}}>
              {t.twoFAStep1}<br/>{t.twoFAStep2}<br/>{t.twoFAStep3}
            </div>
            <div style={{textAlign:'center',marginBottom:16}}>
              <div style={{display:'inline-block',padding:16,background:'#fff',borderRadius:12}}>
                <QRCodeSVG value={data.qr} size={200} level="M"/>
              </div>
            </div>
            <div style={{background:'var(--bg3)',border:'1px solid var(--b1)',borderRadius:9,padding:'10px 14px',marginBottom:16,fontFamily:'var(--mono)',fontSize:12,color:'var(--cy)',wordBreak:'break-all',textAlign:'center'}}>
              <div style={{fontSize:10,color:'var(--t3)',marginBottom:4}}>{t.twoFASecretLabel}</div>
              {data.secret}
            </div>
            <div className="form-group">
              <label className="form-label">{t.twoFAConfirmCode}</label>
              <input className="form-input totp-code-input" type="text" inputMode="numeric" placeholder="——————"
                value={verify} maxLength={6} onChange={e => setVerify(e.target.value.replace(/\D/g, ''))} autoFocus/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={() => { setStep('idle'); setData(null); }}>{t.cancel}</button>
              <button className="btn btn-primary" onClick={confirmEnable} disabled={loading || verify.length !== 6}
                style={{flex:1,justifyContent:'center'}}>
                {loading ? <span className="spin spin-sm"/> : <><I.Check/> {t.twoFAConfirmBtn}</>}
              </button>
            </div>
          </div>
        )}

        {step === 'disable' && (
          <div>
            <div style={{background:'rgba(251,113,133,0.05)',border:'1px solid rgba(251,113,133,0.15)',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:13,color:'var(--re)'}}>
              {t.twoFADisableInfo}
            </div>
            <div className="form-group">
              <label className="form-label">{t.twoFACurrentCode}</label>
              <input className="form-input totp-code-input" type="text" inputMode="numeric" placeholder="——————"
                value={disable} maxLength={6} onChange={e => setDisable(e.target.value.replace(/\D/g, ''))} autoFocus/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={() => setStep('idle')}>{t.cancel}</button>
              <button className="btn btn-danger" onClick={confirmDisable} disabled={loading || disable.length !== 6}
                style={{flex:1,justifyContent:'center'}}>
                {loading ? <span className="spin spin-sm"/> : <><I.X/> {t.disableTwoFA}</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
