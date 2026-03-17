export default function StatPill({ count, label, color, dot, large }) {
  const sz = large
    ? { num: 26, lbl: 11, pad: '12px 18px', r: 12 }
    : { num: 14, lbl: 11, pad: '5px 11px',  r: 8  };
  return (
    <div style={{display:'flex',flexDirection:large?'column':'row',alignItems:'center',gap:large?4:5,
      background:`rgba(${color},0.1)`,borderRadius:sz.r,padding:sz.pad,
      whiteSpace:'nowrap',flex:large?1:undefined,minWidth:large?80:undefined}}>
      {large ? (
        <>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            {dot && <span className={`dot ${dot}`}/>}
            <span style={{fontSize:sz.num,fontWeight:800,letterSpacing:'-1px',color:`rgb(${color})`}}>{count}</span>
          </div>
          <span style={{fontSize:sz.lbl,color:'var(--t3)',fontWeight:500}}>{label}</span>
        </>
      ) : (
        <>
          {dot && <span className={`dot ${dot}`}/>}
          <span style={{fontSize:sz.num,fontWeight:700,color:`rgb(${color})`}}>{count}</span>
          <span style={{fontSize:sz.lbl,color:'var(--t3)'}}>{label}</span>
        </>
      )}
    </div>
  );
}
