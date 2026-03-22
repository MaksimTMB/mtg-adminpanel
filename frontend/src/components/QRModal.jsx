import { QRCodeSVG } from 'qrcode.react';
import { toast } from '../toast.jsx';
import { copyText } from '../utils.jsx';
import { useAppCtx } from '../AppContext.jsx';
import * as I from '../icons.jsx';

export default function QRModal({ user, onClose }) {
  const { t } = useAppCtx();

  const copy = async () => {
    try {
      await copyText(user.link);
      toast(t.copied, 'success');
    } catch {
      toast(t.copyError, 'error');
    }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:320}}>
        <div className="modal-head">
          <div className="modal-title"><I.QrCode/> QR — {user.name}</div>
          <button className="modal-close" onClick={onClose}><I.X/></button>
        </div>
        <div className="modal-body" style={{textAlign:'center'}}>
          <div style={{display:'inline-block',padding:16,background:'#fff',borderRadius:12,marginBottom:14}}>
            <QRCodeSVG value={user.link} size={200} level="M"/>
          </div>
          <button type="button" className="link-box" style={{maxWidth:'100%',justifyContent:'center',width:'100%'}} onClick={copy}>
            <I.Copy/><span className="link-txt">{user.link}</span>
          </button>
          <p style={{fontSize:11,color:'var(--t3)',marginTop:8}}>{t.copyLink}</p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} style={{width:'100%',justifyContent:'center'}}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}
