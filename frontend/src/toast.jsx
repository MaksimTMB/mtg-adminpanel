import { useState } from 'react';
import * as I from './icons.jsx';

let _toast = null;

export function useToast() {
  const [toasts, setToasts] = useState([]);
  _toast = (msg, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };
  return toasts;
}

export const toast = (msg, type) => _toast && _toast(msg, type);

export function Toasts({ list }) {
  const icon = { success: <I.Check/>, error: <I.AlertCircle/>, info: <I.Info/> };
  return (
    <div className="toasts">
      {list.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          {icon[t.type]}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
