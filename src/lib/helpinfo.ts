// Support details, the person's own support conversations and account summary from the website (server update: Api\HelpInfo).
import { call, type Result } from './sharing';
import { readJson, writeJson } from './useLocal';

export interface HelpInfo {
  site: { name: string; url: string; docs: string; contact: string; account: string };
  support: { email: string; phone: string; whatsapp: string; hours: string; address: string; intro: string; topics: string[] };
  conversations: { total: number; recent: { ref: string; topic: string; status: string; priority: string; created_at: string; last_author: string | null }[] };
  account: { name: string; email: string; plan: { key: string; name: string; upgrade_url: string }; tokens: { used: number; max: number }; projects: number };
  /** Admin -> Settings -> Help videos on the website (older servers do not send it). */
  videos?: { channel: string; subscribe: string; items: HelpVideo[] };
}

export interface HelpVideo { topic: string; title: string; icon: string; about: string; has_video: boolean; url: string; thumb: string; docs: string }

/** Used before the website has answered (first start offline, or an older server): links that search the channel. */
export const DEFAULT_CHANNEL = 'https://www.youtube.com/@LibraMedicine';
const T: [string, string, string, string, string][] = [
  ['desktop', 'Desktop app for Windows and macOS', 'display', 'desktop app Windows macOS', 'Install, connect, work offline and sync.'],
  ['offline', 'Work offline', 'wifi-off', 'offline mobile app install', 'Collect without internet, sync later.'],
  ['collecting', 'Collect data and share public links', 'clipboard2-check', 'collect data public link QR', 'Enter data, share links and QR codes.'],
  ['data-grid', 'Clean and correct your data', 'table', 'data grid clean data', 'Search, edit, bulk changes and duplicates.'],
  ['import', 'Import existing data', 'cloud-arrow-up', 'import data excel csv', 'Match columns and check every row first.'],
  ['export', 'Export to Excel, SPSS, Stata and R', 'box-arrow-down', 'export SPSS Stata R', 'Formats, anonymised exports and the codebook.'],
  ['statistics', 'Statistics and charts', 'graph-up-arrow', 'statistics charts analysis', 'Choose a test, read the result, build charts.'],
  ['workbench', 'The statistics workbench', 'grid-3x3', 'statistics workbench', 'Frequencies, cross-tabs, ANOVA, correlation.'],
  ['dashboard', 'Build a live dashboard', 'columns-gap', 'dashboard charts', 'Save charts and arrange them.'],
  ['reports', 'Reports', 'file-earmark-richtext', 'PDF report schedule', 'Print, PDF, HTML and Markdown reports.'],
  ['team', 'Invite your team', 'person-plus', 'invite team roles', 'Invitations, roles and assigned forms.'],
  ['forms', 'Build a form', 'ui-checks-grid', 'form builder', 'Pages, skip logic, repeat groups and sharing.'],
  ['variables', 'Design your variables', 'diagram-3', 'variables codebook', 'Types, validation, options and personal data.'],
  ['account', 'Secure your account and API tokens', 'person-circle', 'two-step verification API token', 'Password, 2-step verification and tokens.'],
  ['overview', 'Platform tour', 'compass', 'Library Medicine tour', 'A quick look at everything the platform does.'],
];
export const fallbackVideos = (server: string) => {
  const base = server.replace(/\/$/, '');
  return {
    channel: DEFAULT_CHANNEL,
    subscribe: `${DEFAULT_CHANNEL}?sub_confirmation=1`,
    items: T.map(([topic, title, icon, q, about]): HelpVideo => ({ topic, title, icon, about, has_video: false, url: `${DEFAULT_CHANNEL}/search?query=${encodeURIComponent(q)}`, thumb: '', docs: `${base}/docs#${topic}` })),
  };
};

export const fetchHelpInfo = (): Promise<Result<HelpInfo>> => call<HelpInfo>('GET', 'api/v1/help-info');
const KEY = 'lm_helpinfo';
export const cachedHelpInfo = () => readJson<{ at: string; data: HelpInfo } | null>(KEY, null);
export const cacheHelpInfo = (data: HelpInfo) => writeJson(KEY, { at: new Date().toISOString(), data });
