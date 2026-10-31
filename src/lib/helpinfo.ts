// Support details, the person's own support conversations and account summary from the website (server update: Api\HelpInfo).
import { call, type Result } from './sharing';
import { readJson, writeJson } from './useLocal';

export interface HelpInfo {
  site: { name: string; url: string; docs: string; contact: string; account: string };
  support: { email: string; phone: string; whatsapp: string; hours: string; address: string; intro: string; topics: string[] };
  conversations: { total: number; recent: { ref: string; topic: string; status: string; priority: string; created_at: string; last_author: string | null }[] };
  account: { name: string; email: string; plan: { key: string; name: string; upgrade_url: string }; tokens: { used: number; max: number }; projects: number };
}

export const fetchHelpInfo = (): Promise<Result<HelpInfo>> => call<HelpInfo>('GET', 'api/v1/help-info');
const KEY = 'lm_helpinfo';
export const cachedHelpInfo = () => readJson<{ at: string; data: HelpInfo } | null>(KEY, null);
export const cacheHelpInfo = (data: HelpInfo) => writeJson(KEY, { at: new Date().toISOString(), data });
