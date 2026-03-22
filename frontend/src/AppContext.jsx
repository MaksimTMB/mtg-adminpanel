import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import T from './i18n.js';

const AppCtx = createContext({});
export const useAppCtx = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [lang,  setLangState]  = useState(() => localStorage.getItem('mtg_lang')  || 'ru');
  const [theme, setThemeState] = useState(() => localStorage.getItem('mtg_theme') || 'dark');
  const [logo,  setLogo]       = useState(null); // data-URL or null

  const setLang = (l) => { setLangState(l); localStorage.setItem('mtg_lang', l); };
  const setTheme = (th) => { setThemeState(th); localStorage.setItem('mtg_theme', th); };

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Init theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  // Fetch logo on mount
  const fetchLogo = useCallback(async () => {
    try {
      const r = await fetch('/logo');
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        setLogo(url);
      } else {
        setLogo(null);
      }
    } catch { setLogo(null); }
  }, []);

  useEffect(() => { fetchLogo(); }, [fetchLogo]);

  const t = T[lang] || T.ru;

  return (
    <AppCtx.Provider value={{ lang, setLang, theme, setTheme, logo, setLogo, fetchLogo, t }}>
      {children}
    </AppCtx.Provider>
  );
}
