import { openUrl } from '@tauri-apps/plugin-opener';
import { Icon } from './ui';
import { webUrl } from '../lib/access';
import { useSession } from '../providers/AppProvider';
import type { ProjectTab } from '../providers/UiProvider';

/** “Open on website” button for the matching page of this project on librarymedicine.online. */
export function WebLink({ project, tab }: { project: string; tab: ProjectTab }) {
  const { server, online, toast } = useSession();
  return (
    <button className="btn" disabled={!online} title={online ? 'Open this page on librarymedicine.online' : 'Connect to the internet to open the website'} onClick={() => openUrl(webUrl(server, project, tab)).catch(() => toast('Could not open the website.', 'error'))}>
      <Icon name="globe2" />Website
    </button>
  );
}
