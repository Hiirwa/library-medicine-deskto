// Every area of the app has its own accent colour, so pages are easy to tell apart and the app feels alive.
import type { Route } from '../providers/UiProvider';

export type Accent = 'blue' | 'violet' | 'teal' | 'rose' | 'indigo' | 'amber' | 'cyan' | 'emerald' | 'orange' | 'slate' | 'sky';

const TAB: Record<string, Accent> = { overview: 'blue', variables: 'violet', forms: 'teal', sharing: 'rose', statistics: 'indigo', workbench: 'amber', dashboard: 'cyan', reports: 'emerald', data: 'blue', import: 'emerald', export: 'orange', files: 'sky' };
const PAGE: Record<string, Accent> = { home: 'blue', sync: 'sky', settings: 'slate', help: 'teal' };

export const accentFor = (r: Route): Accent => (r.page === 'project' ? TAB[r.tab] ?? 'blue' : PAGE[r.page] ?? 'blue');

/** Sidebar item label → colour. */
export const NAV_HUE: Record<string, Accent> = {
  'My projects': 'blue', 'Sync centre': 'sky', Overview: 'blue', Variables: 'violet', Forms: 'teal', Sharing: 'rose', Statistics: 'indigo', Workbench: 'amber', Dashboard: 'cyan', Reports: 'emerald',
  'Data view': 'blue', Import: 'emerald', Export: 'orange', Files: 'sky', Settings: 'slate', 'Help & documentation': 'teal',
};
