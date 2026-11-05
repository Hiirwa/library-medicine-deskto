import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CardTitle, Icon } from './ui';
import { cachedHelpInfo, fallbackVideos, fetchHelpInfo, type HelpVideo } from '../lib/helpinfo';
import { useSession } from '../providers/AppProvider';

/** Topics that matter most in the desktop app come first. */
const ORDER = ['desktop', 'offline', 'collecting', 'data-grid', 'import', 'export', 'statistics', 'workbench', 'dashboard', 'reports', 'team', 'forms', 'variables', 'account', 'overview'];
const rank = (t: string) => { const i = ORDER.indexOf(t); return i < 0 ? 99 : i; };

/** The video list from the website (Admin → Settings → Help videos), the cached copy, or links that search the channel. */
export function useHelpVideos() {
  const { online, server } = useSession();
  const q = useQuery({ queryKey: ['helpinfo'], queryFn: fetchHelpInfo, enabled: online, staleTime: 30000 });
  const live = q.data && q.data.ok ? q.data.data.videos : undefined;
  const cached = useMemo(() => cachedHelpInfo()?.data.videos, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = live ?? cached ?? fallbackVideos(server);
  return { ...v, items: [...v.items].sort((a, b) => rank(a.topic) - rank(b.topic)) };
}

/** "Watch the video" for one topic (used in the project tour). */
export function VideoButton({ topic, label = 'Watch the video' }: { topic: string; label?: string }) {
  const { items } = useHelpVideos();
  const { toast } = useSession();
  const v = items.find((x) => x.topic === topic);
  if (!v) return null;
  return <button className="btn btn-sm" onClick={() => openUrl(v.url).catch(() => toast('Could not open YouTube.', 'error'))}><Icon name="youtube" className="text-[#e11d48]" />{label}</button>;
}

export function HelpVideos() {
  const { online, toast } = useSession();
  const { channel, subscribe, items } = useHelpVideos();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const open = (url: string) => openUrl(url).catch(() => toast('Could not open YouTube.', 'error'));
  const list = items.filter((v) => !q.trim() || `${v.title} ${v.about}`.toLowerCase().includes(q.trim().toLowerCase()));
  const shown = all || q.trim() ? list : list.slice(0, 6);
  const ready = items.filter((v) => v.has_video).length;
  return (
    <section className="card p-5 anim-in">
      <CardTitle icon="youtube" tone="k-danger" title="Video tutorials" sub={ready ? `${ready} ready to watch · plays on YouTube in your browser` : 'Step-by-step videos on our YouTube channel'}>
        <button className="btn btn-sm" onClick={() => open(channel)}><Icon name="collection-play" />Channel</button>
        <button className="btn btn-sm btn-primary" onClick={() => open(subscribe)}><Icon name="bell" />Subscribe</button>
      </CardTitle>
      {!online && <p className="muted mt-2 text-sm"><Icon name="wifi-off" /> You are offline: videos open once you are connected.</p>}
      <div className="field-ic mt-3"><Icon name="search" /><input className="field" placeholder="Find a video…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
        {shown.map((v: HelpVideo) => (
          <button key={v.topic} className="well p-0 text-left anim-in" style={{ overflow: 'hidden' }} onClick={() => open(v.url)} title={v.has_video ? 'Watch on YouTube' : 'Find this topic on our YouTube channel'}>
            <span className="relative block" style={{ aspectRatio: '16 / 9', background: 'linear-gradient(135deg, color-mix(in srgb, var(--rh-brand) 22%, var(--rh-surface)), color-mix(in srgb, var(--rh-teal) 18%, var(--rh-surface)))' }}>
              {v.thumb ? <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                : <span className="absolute inset-0 grid place-items-center text-3xl" style={{ color: 'var(--rh-brand)' }}><Icon name={v.icon} /></span>}
              <span className="chip absolute" style={{ right: '.5rem', bottom: '.5rem', background: v.has_video ? '#ff0033' : 'rgba(15,23,42,.72)', color: '#fff' }}><Icon name={v.has_video ? 'play-fill' : 'search'} />{v.has_video ? 'Watch' : 'Find'}</span>
            </span>
            <span className="block p-3"><b className="ink block text-sm">{v.title}</b><small className="muted block">{v.about}</small></span>
          </button>
        ))}
      </div>
      {!list.length && <p className="muted mt-3 text-sm">No video matches. Try another word, or open the channel.</p>}
      {!q.trim() && list.length > 6 && <button className="btn btn-sm mt-3 w-full" onClick={() => setAll(!all)}><Icon name={all ? 'chevron-up' : 'chevron-down'} />{all ? 'Show fewer' : `Show all ${list.length} videos`}</button>}
    </section>
  );
}
