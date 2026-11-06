import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ProjectTab = 'overview' | 'variables' | 'forms' | 'sharing' | 'statistics' | 'workbench' | 'dashboard' | 'reports' | 'data' | 'import' | 'export' | 'files';
export type Route =
  | { page: 'home' }
  | { page: 'project'; project: string; tab: ProjectTab }
  | { page: 'sync' }
  | { page: 'settings' }
  | { page: 'help' };

export type Theme = 'system' | 'light' | 'dark';
export interface EditorTarget { project: string; record: string | null; form: string | null; copyOf?: string }

interface Ui {
  route: Route;
  go: (r: Route) => void;
  back: () => void;
  /** last opened project (sidebar keeps showing it) */
  currentProject: string | null;
  theme: Theme;
  dark: boolean;
  setTheme: (t: Theme) => void;
  collapsed: boolean;
  toggleSidebar: () => void;
  editor: EditorTarget | null;
  openEditor: (t: EditorTarget) => void;
  closeEditor: () => void;
  palette: boolean;
  setPalette: (open: boolean) => void;
  /** colourful look: colour-coded menu, gradient tiles and headers (on by default) */
  vivid: boolean;
  setVivid: (on: boolean) => void;
}

const Ctx = createContext<Ui | null>(null);
export const useUi = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUi outside UiProvider');
  return c;
};

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export function UiProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => {
    try { const r = JSON.parse(ls.get('lm_route') ?? 'null') as Route | null; return r && r.page ? r : { page: 'home' }; } catch { return { page: 'home' }; }
  });
  const [, setHistory] = useState<Route[]>([]);
  const [currentProject, setCurrentProject] = useState<string | null>(() => ls.get('lm_project'));
  const [theme, setThemeState] = useState<Theme>(() => (ls.get('lm_theme') as Theme) || 'system');
  const [sysDark, setSysDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [collapsed, setCollapsed] = useState(() => ls.get('lm_sidebar') === '1');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [palette, setPalette] = useState(false);
  const [vivid, setVividState] = useState(() => ls.get('lm_vivid') !== '0');
  useEffect(() => { document.documentElement.setAttribute('data-vivid', vivid ? '1' : '0'); }, [vivid]);
  const setVivid = useCallback((on: boolean) => { setVividState(on); ls.set('lm_vivid', on ? '1' : '0'); }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = theme === 'dark' || (theme === 'system' && sysDark);
  useEffect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }, [dark]);

  const go = useCallback((r: Route) => {
    setRoute((cur) => {
      if (JSON.stringify(cur) !== JSON.stringify(r)) setHistory((h) => [...h.slice(-30), cur]);
      return r;
    });
    if (r.page === 'project') { setCurrentProject(r.project); ls.set('lm_project', r.project); }
    ls.set('lm_route', JSON.stringify(r));
  }, []);
  const back = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) { setRoute(prev); ls.set('lm_route', JSON.stringify(prev)); }
      return h.slice(0, -1);
    });
  }, []);

  const setTheme = useCallback((t: Theme) => { setThemeState(t); ls.set('lm_theme', t); }, []);
  const toggleSidebar = useCallback(() => setCollapsed((c) => { ls.set('lm_sidebar', c ? '0' : '1'); return !c; }), []);

  const value = useMemo<Ui>(() => ({
    route, go, back, currentProject, theme, dark, setTheme, collapsed, toggleSidebar,
    editor, openEditor: setEditor, closeEditor: () => setEditor(null), palette, setPalette, vivid, setVivid,
  }), [route, go, back, currentProject, theme, dark, setTheme, collapsed, toggleSidebar, editor, palette, vivid, setVivid]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
