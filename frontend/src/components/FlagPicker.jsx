import { useState } from 'react';
import { COUNTRIES } from '../constants.js';
import { flagUrl } from '../utils.jsx';

export default function FlagPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = COUNTRIES.find(c => c.code === value);
  return (
    <div style={{position:'relative'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 11px',background:'var(--bg3)',
        border:'1px solid var(--b2)',borderRadius:9,cursor:'pointer',transition:'border-color var(--tx)'}}
        onClick={() => setOpen(!open)}>
        {current ? (
          <>
            <img src={flagUrl(current.code,'w40')} alt={current.code} style={{width:24,height:18,objectFit:'cover',borderRadius:2}}/>
            <span style={{fontSize:13,color:'var(--t1)'}}>{current.name}</span>
          </>
        ) : (
          <span style={{fontSize:13,color:'var(--t3)'}}>Выбрать флаг...</span>
        )}
        <span style={{marginLeft:'auto',color:'var(--t3)',fontSize:10}}>▼</span>
      </div>
      {open && (
        <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,right:0,background:'var(--bg2)',
          border:'1px solid var(--b2)',borderRadius:10,padding:8,zIndex:100,
          boxShadow:'0 8px 32px rgba(0,0,0,.5)',maxHeight:200,overflowY:'auto'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'6px 4px',borderRadius:7,cursor:'pointer',border:'1px solid transparent'}}
              onClick={() => { onChange(null); setOpen(false); }}>
              <span style={{fontSize:16}}>🌐</span>
              <span style={{fontSize:9,color:'var(--t3)'}}>нет</span>
            </div>
            {COUNTRIES.map(c => (
              <div key={c.code}
                style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'6px 4px',borderRadius:7,cursor:'pointer',
                  border:`1px solid ${value===c.code?'rgba(124,111,247,.4)':'transparent'}`,
                  background:value===c.code?'rgba(124,111,247,.1)':'transparent',transition:'all .15s'}}
                onClick={() => { onChange(c.code); setOpen(false); }}>
                <img src={flagUrl(c.code,'w40')} alt={c.code} style={{width:24,height:18,objectFit:'cover',borderRadius:2}}/>
                <span style={{fontSize:9,color:'var(--t3)',textAlign:'center',lineHeight:1.2}}>{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
