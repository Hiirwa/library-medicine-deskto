// Plans shown when a person's account cannot create API tokens. Edit PLANS to match the website's pricing;
// leave `price` empty to show “See prices on the website” instead of a number.
import type { Me } from './types';

export interface Plan { id: string; name: string; price?: string; period?: string; tagline: string; tokens: boolean; recommended?: boolean; features: [boolean, string][] }
export const PRICING_PATH = '/pricing';

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', tagline: 'Use the platform in your browser', tokens: false,
    features: [[true, 'Use librarymedicine.online in the browser'], [false, 'API tokens'], [false, 'Desktop app: offline collection and sync']] },
  { id: 'pro', name: 'Pro', tagline: 'Collect data in the field with the desktop app', tokens: true, recommended: true,
    features: [[true, 'Everything in Free'], [true, 'API tokens (read & write)'], [true, 'Desktop app: offline collection and sync']] },
  { id: 'max', name: 'Max', tagline: 'For larger teams and studies', tokens: true,
    features: [[true, 'Everything in Pro'], [true, 'API tokens (read & write)'], [true, 'Desktop app: offline collection and sync'], [true, 'Other limits: see the pricing page']] },
];

const NO = /^(free|basic|starter|trial|none|community)$/i;
const YES = /(pro|max|team|business|enterprise|institution|premium|plus|paid)/i;

/** Plan name as the server reports it, if it does. */
export function planName(me: Me | null | undefined): string | null {
  const p = (me as { plan?: unknown } | null)?.plan;
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') { const o = p as { name?: string; slug?: string; title?: string }; return o.name ?? o.title ?? o.slug ?? null; }
  return null;
}

/** 'no' → show the plans page; 'yes' → show the token instructions; 'unknown' → show the instructions (the server decides when the token is checked). */
export function apiTokenAccess(me: Me | null | undefined): 'yes' | 'no' | 'unknown' {
  if (!me) return 'unknown';
  const m = me as unknown as Record<string, unknown>;
  const feat = (m.features ?? m.plan_features ?? m.entitlements) as Record<string, unknown> | undefined;
  const flags = [m.api_tokens, m.api_tokens_enabled, m.can_use_api_tokens, m.can_create_tokens, m.api_access, feat?.api_tokens, feat?.api, (m.plan as { api_tokens?: unknown } | undefined)?.api_tokens];
  for (const f of flags) if (typeof f === 'boolean') return f ? 'yes' : 'no';
  const n = planName(me);
  if (n) { if (NO.test(n.trim())) return 'no'; if (YES.test(n)) return 'yes'; }
  return 'unknown';
}

/** A refused token check that is about the plan rather than a wrong token. */
export const isPlanRefusal = (status: number, message: string) => status === 402 || (status === 403 && /plan|upgrade|subscription|tier|pro|max/i.test(message)) || /upgrade|plan does not|not included in your plan/i.test(message);

const TAGLINE: Record<string, string> = { free: 'Use the platform in your browser', pro: 'Collect data in the field with the desktop app', max: 'For larger teams and studies' };
const num = (n: number, one: string, many: string) => (n < 0 ? `Unlimited ${many}` : n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/** Plan cards built from what the server reports (names, prices, limits). Falls back to PLANS when the server does not send them yet. */
export function plansFor(me: Me | null | undefined): Plan[] {
  const list = me?.plans;
  if (!list?.length) return PLANS;
  const rec = list.find((p) => p.key !== 'free' && p.limits.tokens !== 0)?.key;
  return list.map((p): Plan => ({
    id: p.key, name: p.name, price: p.price && /\d/.test(p.price) ? p.price : p.price || undefined, period: p.price && /\d/.test(p.price) ? p.period : undefined,
    tagline: TAGLINE[p.key] ?? '', tokens: p.limits.tokens !== 0, recommended: p.key === rec,
    features: [
      [p.limits.tokens !== 0, p.limits.tokens === 0 ? 'API tokens' : num(p.limits.tokens, 'API token', 'API tokens')],
      [p.limits.offline, 'Offline forms and desktop sync'],
      [true, num(p.limits.projects, 'active project', 'active projects')],
      [true, `${num(p.limits.forms, 'form', 'forms')} per project`],
      [true, `${num(p.limits.records, 'record', 'records')} per project`],
    ],
  }));
}
