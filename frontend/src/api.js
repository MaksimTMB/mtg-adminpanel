export const getToken    = () => localStorage.getItem('mtg_token') || '';
export const setToken    = (t) => localStorage.setItem('mtg_token', t);
export const getTotpCode = () => sessionStorage.getItem('mtg_totp_code') || '';
export const setTotpCode = (c) => {
  if (c) sessionStorage.setItem('mtg_totp_code', c);
  else   sessionStorage.removeItem('mtg_totp_code');
};
export const getTotpSession = () => localStorage.getItem('mtg_totp_session') || '';
export const setTotpSession = (s) => {
  if (s) localStorage.setItem('mtg_totp_session', s);
  else   localStorage.removeItem('mtg_totp_session');
};
export const clearTotpAuth = () => {
  setTotpCode('');
  setTotpSession('');
};

// Global handler called when any request gets TOTP_REQUIRED (e.g. after enabling 2FA mid-session)
let _totpRequiredHandler = null;
export function setTotpRequiredHandler(fn) { _totpRequiredHandler = fn; }

const _pend = {};
export async function api(method, path, body) {
  const key = `${method}:${path}`;
  if (method === 'GET' && _pend[key]) return _pend[key];

  const headers = { 'Content-Type': 'application/json', 'x-auth-token': getToken() };
  const totpSession = getTotpSession();
  const totpCode = getTotpCode();
  if (totpSession) headers['x-totp-code'] = totpSession;
  else if (totpCode) headers['x-totp-code'] = totpCode;

  const req = fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async r => {
      delete _pend[key];
      // Persist session token issued after TOTP validation (valid 24h)
      const session = r.headers.get('x-totp-session');
      if (session) {
        setTotpSession(session);
        setTotpCode('');
      }
      if (r.status === 401) {
        setToken('');
        clearTotpAuth();
        throw new Error('Unauthorized');
      }
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}));
        if (d.totp) {
          clearTotpAuth();
          if (_totpRequiredHandler) _totpRequiredHandler();
          throw new Error('TOTP_REQUIRED');
        }
        throw new Error(d.error || 'Forbidden');
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'API error');
      return data;
    })
    .catch(e => { delete _pend[key]; throw e; });

  if (method === 'GET') _pend[key] = req;
  return req;
}
