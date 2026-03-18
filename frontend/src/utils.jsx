export const flagUrl = (code, size = 'w40') =>
  code ? `https://flagcdn.com/${size}/${code}.png` : null;

export const copyText = (txt) =>
  navigator.clipboard.writeText(txt).then(() => {
    // toast imported dynamically to avoid circular deps — caller handles it
  });

export function expiryBadge(expires_at, small) {
  if (!expires_at) return <span style={{color:'var(--t3)',fontSize:small?11:12}}>∞</span>;
  const d = Math.floor((new Date(expires_at) - new Date()) / 86400000);
  if (d < 0) return <span className="badge badge-red">истёк</span>;
  return <span style={{fontFamily:'var(--mono)',fontSize:small?11:12,color:d<3?'var(--am)':'var(--t2)'}}>{d}д</span>;
}

export function parseVer(raw) {
  if (!raw || raw === 'error' || raw === 'unknown') return { name: raw || '—', date: null };
  const m = raw.match(/^([\w:.]+)\s*\|\s*built\s+([\d-T:.Z]+)/);
  if (m) {
    const d = new Date(m[2]);
    const date = isNaN(d) ? null : d.toLocaleDateString('ru-RU', {day:'2-digit',month:'short',year:'numeric'});
    return { name: m[1], date };
  }
  return { name: raw.slice(0, 20), date: null };
}

export function parseBytes(str) {
  if (!str) return 0;
  const m = str.match(/([\d.]+)(GB|MB|KB|B)/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === 'GB') return Math.round(v * 1073741824);
  if (u === 'MB') return Math.round(v * 1048576);
  if (u === 'KB') return Math.round(v * 1024);
  return Math.round(v);
}
