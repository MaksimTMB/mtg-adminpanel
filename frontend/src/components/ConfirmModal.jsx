import { useAppCtx } from '../AppContext.jsx';
import * as I from '../icons.jsx';

export default function ConfirmModal({ title, message, confirmText, onConfirm, onClose }) {
  const { t } = useAppCtx();
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-head">
          <div className="modal-title" style={{color:'var(--re)'}}>
            <I.AlertCircle/> {title}
          </div>
          <button className="modal-close" onClick={onClose}><I.X/></button>
        </div>
        <div className="modal-body">
          <div style={{
            display:'flex',gap:16,alignItems:'flex-start',
            background:'rgba(251,113,133,0.07)',border:'1px solid rgba(251,113,133,0.2)',
            borderRadius:10,padding:'14px 16px',
          }}>
            <div style={{color:'var(--re)',flexShrink:0,marginTop:1}}><I.AlertCircle/></div>
            <div style={{fontSize:14,lineHeight:1.6,color:'var(--t1)'}}>{message}</div>
          </div>
          <div style={{fontSize:12,color:'var(--t3)',marginTop:12}}>{t.irreversible}</div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-danger" onClick={() => { onConfirm(); onClose(); }}>
            <I.Trash/> {confirmText || t.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
