// Shapes exchanged with the Library Medicine sync API (/api/v1/sync) and stored locally.

export type Role = 'owner' | 'researcher' | 'collector' | 'viewer';

export interface Project {
  uuid: string;
  title: string;
  description: string;
  role: Role;
  status: 'active' | 'archived' | string;
  start_date: string | null;
  end_date: string | null;
  period: string | null;
  schema_version: number;
  can: { add: boolean; edit: boolean; delete: boolean; pii: boolean };
}

export interface FormLayoutItem { type: 'variable' | 'note' | 'heading' | string; var?: string; text?: string }
export interface FormLayout {
  pages: { id: string; title?: string; description?: string; items?: FormLayoutItem[]; sections?: { id: string; title?: string; description?: string; items?: FormLayoutItem[] }[] }[];
}

export interface Form { uuid: string; project: string; title: string; status: string; layout: FormLayout }

export interface Variable {
  name: string;
  label: string | null;
  type: string;
  description: string | null;
  help_text: string | null;
  required: boolean;
  default: unknown;
  config: { options?: { value: string; label: string }[]; min?: number; max?: number; accept?: string[]; max_mb?: number; [k: string]: unknown };
  visibility: string;
  is_pii: boolean;
  sort_order: number;
}

export type RecordData = Record<string, unknown>;

export interface ServerRecord {
  uuid: string;
  project: string;
  form: string | null;
  status: string;
  source: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  data: RecordData;
}

export interface LocalRecord extends Omit<ServerRecord, 'source'> {
  dirty: number;
  sync_error: string | null;
}

export interface FileManifest { uuid: string; record: string | null; variable: string | null; name: string; mime: string; size: number; sha256: string }

export interface LocalFile {
  uuid: string;
  record: string | null;
  project: string;
  variable: string | null;
  name: string;
  mime: string | null;
  size: number;
  sha256: string | null;
  local_path: string | null;
  state: 'remote' | 'downloaded' | 'pending_upload' | 'uploaded' | 'error';
  error: string | null;
}

export interface ChangeResult {
  uuid: string;
  status: 'applied' | 'server_wins' | 'rejected' | 'unchanged';
  version?: number;
  error?: string;
  errors?: Record<string, string>;
  record?: ServerRecord;
}

export interface SyncResponse {
  server_time: string;
  results: ChangeResult[];
  meta: { projects: Project[]; forms: Form[]; variables: Record<string, Variable[]> } | null;
  records: ServerRecord[];
  files: FileManifest[];
  has_more: boolean;
  cursor: Record<string, unknown> | null;
  user: { id: string; name: string; email: string };
}

export interface Me {
  id: string; email: string; name: string; institution: string | null; scope?: { project_id: number | null; scopes: string[] };
  /** the account's plan, when the server reports it (name or object); used to decide whether API tokens are available */
  plan?: string | { name?: string; slug?: string; title?: string; api_tokens?: boolean } | null;
  features?: Record<string, boolean>;
}

export interface OutboxRow {
  id: number;
  uuid: string;
  op: 'upsert' | 'delete';
  project: string;
  form: string | null;
  partial: number;
  status: string | null;
  data: string | null;
  client_updated_at: string;
  attempts: number;
  last_error: string | null;
}
