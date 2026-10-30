// Typed wrappers around the Rust commands (src-tauri/src/lib.rs).
import { invoke } from '@tauri-apps/api/core';

export interface ApiResponse<T = unknown> { status: number; body: T }
export interface WorkspaceInfo { root: string; files: string; outbox: string }
export interface ImportedFile { uuid: string; path: string; name: string; size: number; sha256: string; mime: string }
export interface NetworkStatus { online: boolean; server: string }

/** auth: 'token' (stored API token), 'none', or a session JWT */
export const api = <T = unknown>(method: string, path: string, json?: unknown, auth: string = 'token') =>
  invoke<ApiResponse<T>>('api_request', { req: { method, path, json: json ?? null, auth } });

export const native = {
  workspace: () => invoke<WorkspaceInfo>('workspace_info'),
  openLocal: (path: string) => invoke<void>('open_local', { path }),
  revealLocal: (path?: string) => invoke<void>('reveal_local', { path: path ?? null }),
  importAttachment: (source: string) => invoke<ImportedFile>('import_attachment', { source }),
  removeLocal: (path: string) => invoke<void>('remove_local', { path }),
  secureSet: (key: string, value: string) => invoke<void>('secure_set', { key, value }),
  secureGet: (key: string) => invoke<string | null>('secure_get', { key }),
  secureDelete: (key: string) => invoke<void>('secure_delete', { key }),
  hasToken: () => invoke<boolean>('has_token'),
  setServer: (url: string) => invoke<string>('set_server', { url }),
  saveExport: (path: string, contents: string) => invoke<void>('save_export', { path, contents }),
  workspaceSize: () => invoke<number>('workspace_size'),
  networkStatus: () => invoke<NetworkStatus>('network_status'),
  checkNetwork: () => invoke<NetworkStatus>('check_network_now'),
  download: (uuid: string, project: string, name: string, sha256: string | null) =>
    invoke<string>('download_attachment', { uuid, project, name, sha256 }),
  upload: (path: string, uuid: string, project: string, variable: string, sha256: string) =>
    invoke<ApiResponse<{ ok?: boolean; error?: string; already_received?: boolean }>>('upload_attachment', { path, uuid, project, variable, sha256 }),
};

/** Message from a non-2xx API answer. */
export function apiError(r: ApiResponse<unknown>, fallback = 'The server refused the request.'): string {
  const b = r.body as { error?: string; message?: string; raw?: string } | null;
  return (b && (b.error || b.message)) || (r.status === 401 ? 'Not authorised (wrong or revoked token).' : `${fallback} (HTTP ${r.status})`);
}
