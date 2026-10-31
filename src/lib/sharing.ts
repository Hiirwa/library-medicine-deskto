// Sharing and team management through the server's API (needs the matching server update: Api\Sharing).
import { api, apiError } from './native';

export type RoleKey = 'owner' | 'researcher' | 'collector' | 'viewer';
export const ROLES: RoleKey[] = ['owner', 'researcher', 'collector', 'viewer'];
export const ROLE_INFO: Record<RoleKey, { label: string; icon: string; text: string }> = {
  owner: { label: 'Owner', icon: 'award', text: 'Manages the project and the team' },
  researcher: { label: 'Researcher', icon: 'mortarboard', text: 'Designs forms, analyses and exports data' },
  collector: { label: 'Data collector', icon: 'clipboard2-check', text: 'Enters data in the forms assigned to them' },
  viewer: { label: 'Viewer', icon: 'eye', text: 'Reads results, changes nothing' },
};

export type Access = 'public' | 'authenticated' | 'assigned';
export const ACCESS_INFO: Record<Access, { label: string; icon: string; text: string }> = {
  assigned: { label: 'Assigned collectors', icon: 'person-check', text: 'Owners, researchers and the collectors you assign.' },
  authenticated: { label: 'Any project member', icon: 'people', text: 'Every signed-in member who can submit.' },
  public: { label: 'Anyone with the link', icon: 'globe2', text: 'Public link and QR code, no account needed.' },
};

export interface FormSettings { submit_message: string; show_progress: boolean; allow_multiple: boolean; offline: boolean; close_at: string | null; max_responses: number | null; allow_edit: boolean; edit_days: number }
export interface SharingForm { id: string; title: string; status: 'draft' | 'open' | 'closed' | string; access: Access; public_url: string | null; responses: number; last_response: string | null; assigned: number; settings: FormSettings }
export interface Member { id: number; name: string; email: string; institution: string | null; role: RoleKey; joined_at: string; last_login_at: string | null; records: number; last_record_at: string | null; forms: string[]; is_me: boolean }
export interface Invitation { id: number; email: string; role: RoleKey; expires_at: string; created_at: string; invited_by: string | null }
export interface Overview {
  project: { id: string; title: string; status: string };
  role: RoleKey;
  plan: { key: string; name: string; upgrade_url: string };
  limits: Record<RoleKey, { used: number; max: number }>;
  features: { public_form: boolean; auto_close: boolean; offline: boolean; submit_again: boolean; edit_response: boolean };
  caps: { close_max: string | null; max_responses_max: number | null };
  can: { manage_privileged: boolean };
  forms: SharingForm[]; members: Member[]; invitations: Invitation[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; upgrade?: string; unsupported?: boolean };

async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  try {
    const r = await api<T>(method, path, body);
    if (r.status >= 200 && r.status < 300) return { ok: true, data: r.body };
    const b = r.body as { error?: string; upgrade?: string } | null;
    const unsupported = r.status === 404 && !(b && b.error); // the route does not exist: the server has not been updated yet
    return { ok: false, status: r.status, unsupported, upgrade: b?.upgrade, error: unsupported ? 'This server cannot manage sharing from the app yet.' : apiError(r) };
  } catch (e) {
    return { ok: false, status: 0, error: String(e).replace(/^Error: /, '') };
  }
}

const base = (p: string) => `api/v1/projects/${p}`;
export const fetchSharing = (p: string) => call<Overview>('GET', `${base(p)}/sharing`);
export const saveFormSharing = (p: string, form: string, body: { access?: Access; status?: string; settings?: Partial<FormSettings> }) => call<{ ok: boolean; message: string }>('POST', `${base(p)}/forms/${form}/sharing`, body);
export const inviteMembers = (p: string, body: { emails: string; role: RoleKey; forms?: string[] }) => call<{ ok: boolean; sent: number; blocked: number; message: string; invite_link: { email: string; link: string } | null }>('POST', `${base(p)}/members/invite`, body);
export const updateMember = (p: string, id: number, body: { role?: RoleKey; forms?: string[] }) => call<{ ok: boolean; message: string }>('POST', `${base(p)}/members/${id}/role`, body);
export const removeMember = (p: string, id: number) => call<{ ok: boolean; message: string }>('POST', `${base(p)}/members/${id}/remove`, {});
export const revokeInvitation = (p: string, id: number) => call<{ ok: boolean; message: string }>('POST', `${base(p)}/invitations/${id}/revoke`, {});
export const resendInvitation = (p: string, id: number) => call<{ ok: boolean; message: string; invite_link: { email: string; link: string } }>('POST', `${base(p)}/invitations/${id}/resend`, {});

export const parseEmails = (s: string) => [...new Set(s.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
