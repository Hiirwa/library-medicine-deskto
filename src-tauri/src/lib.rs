//! Library Medicine desktop: native side.
//!
//! * Workspace folder (Documents\Library Medicine) created on first start, with the user's own permissions.
//! * Secrets (the API token) kept in the Windows Credential Manager through the `keyring` crate.
//! * All network traffic (JSON API calls, file downloads and uploads) goes through Rust with `reqwest`,
//!   so the web view needs no CORS exceptions and the token never has to live in JavaScript.
//! * A background network monitor checks that the server is reachable and emits `network-status`.
//! * Local data lives in SQLite (tauri-plugin-sql); the schema is created by the migrations below.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::io::AsyncWriteExt;

const KEYRING_SERVICE: &str = "online.librarymedicine.desktop";
const DEFAULT_SERVER: &str = "https://librarymedicine.online";
const DB_URL: &str = "sqlite:library-medicine.db";
const USER_AGENT: &str = concat!("LibraryMedicineDesktop/", env!("CARGO_PKG_VERSION"));

// ---------------------------------------------------------------------------------------------- state

struct AppState {
    http: reqwest::Client,
    server: Mutex<String>,
    token: Mutex<Option<String>>,
    online: Arc<AtomicBool>,
    workspace: PathBuf,
}

#[derive(Serialize, Clone)]
struct NetworkStatus {
    online: bool,
    server: String,
}

#[derive(Serialize)]
struct WorkspaceInfo {
    root: String,
    files: String,
    outbox: String,
}

#[derive(Serialize)]
struct ApiResponse {
    status: u16,
    body: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequest {
    method: String,
    path: String,
    #[serde(default)]
    json: Option<Value>,
    /// "token" = the stored API token, "none" = no auth, anything else = a bearer value (session JWT)
    #[serde(default)]
    auth: Option<String>,
}

#[derive(Serialize)]
struct ImportedFile {
    uuid: String,
    path: String,
    name: String,
    size: u64,
    sha256: String,
    mime: String,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------------------------- workspace

/// Documents\Library Medicine (falls back to the app data folder when Documents is unavailable).
fn workspace_root(app: &AppHandle) -> PathBuf {
    if let Some(docs) = dirs::document_dir() {
        return docs.join("Library Medicine");
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("Library Medicine"))
        .join("workspace")
}

fn ensure_workspace(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root.join("files"))?;
    std::fs::create_dir_all(root.join("outbox-files"))?;
    let readme = root.join("README.txt");
    if !readme.exists() {
        std::fs::write(
            &readme,
            "Library Medicine desktop workspace\r\n\r\n\
             files\\         files attached to your records, downloaded for offline use (one folder per project)\r\n\
             outbox-files\\  files you attached while offline, waiting to be uploaded\r\n\r\n\
             Do not rename or move files in these folders: the app keeps track of them.\r\n",
        )?;
    }
    Ok(())
}

/// Keeps a file name safe for Windows (no reserved characters, no trailing dots/spaces, sane length).
fn safe_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    s = s.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() {
        s = "file".into();
    }
    if s.chars().count() > 120 {
        let ext = Path::new(&s).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let stem: String = s.chars().take(110).collect();
        s = format!("{stem}{ext}");
    }
    s
}

fn inside(root: &Path, p: &Path) -> bool {
    match (root.canonicalize(), p.canonicalize()) {
        (Ok(r), Ok(c)) => c.starts_with(r),
        _ => false,
    }
}

fn is_uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

#[tauri::command]
fn workspace_info(state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    ensure_workspace(&state.workspace).map_err(err)?;
    Ok(WorkspaceInfo {
        root: state.workspace.display().to_string(),
        files: state.workspace.join("files").display().to_string(),
        outbox: state.workspace.join("outbox-files").display().to_string(),
    })
}

/// Opens a file from the workspace with its default Windows program.
#[tauri::command]
fn open_local(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !inside(&state.workspace, &p) {
        return Err("Only files inside the Library Medicine workspace can be opened.".into());
    }
    app.opener().open_path(p.display().to_string(), None::<&str>).map_err(err)
}

/// Shows a workspace file (or the workspace itself) in Explorer.
#[tauri::command]
fn reveal_local(app: AppHandle, state: State<'_, AppState>, path: Option<String>) -> Result<(), String> {
    let p = path.map(PathBuf::from).unwrap_or_else(|| state.workspace.clone());
    if !inside(&state.workspace, &p) && p != state.workspace {
        return Err("Only the Library Medicine workspace can be shown.".into());
    }
    app.opener().reveal_item_in_dir(p).map_err(err)
}

/// Copies a file the user picked into outbox-files, giving it the id the server will keep.
#[tauri::command]
async fn import_attachment(state: State<'_, AppState>, source: String) -> Result<ImportedFile, String> {
    let src = PathBuf::from(&source);
    let meta = tokio::fs::metadata(&src).await.map_err(err)?;
    if !meta.is_file() {
        return Err("Choose a file, not a folder.".into());
    }
    if meta.len() > 50 * 1024 * 1024 {
        return Err("The file is larger than 50 MB.".into());
    }
    let name = safe_name(&src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into()));
    let id = uuid::Uuid::new_v4().to_string();
    let dir = state.workspace.join("outbox-files");
    tokio::fs::create_dir_all(&dir).await.map_err(err)?;
    let dest = dir.join(format!("{id}__{name}"));
    let bytes = tokio::fs::read(&src).await.map_err(err)?;
    let sha = hex::encode(Sha256::digest(&bytes));
    tokio::fs::write(&dest, &bytes).await.map_err(err)?;
    Ok(ImportedFile {
        uuid: id,
        path: dest.display().to_string(),
        mime: mime_guess::from_path(&dest).first_or_octet_stream().essence_str().to_string(),
        name,
        size: meta.len(),
        sha256: sha,
    })
}

/// Deletes a local copy (inside the workspace only).
#[tauri::command]
async fn remove_local(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !inside(&state.workspace, &p) {
        return Ok(());
    }
    tokio::fs::remove_file(p).await.map_err(err)
}

/// Writes an export (CSV, codebook…) to the place the user picked in the Save dialog.
/// Only plain-text export types are allowed, so this cannot be used to drop programs on the computer.
#[tauri::command]
async fn save_export(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !["csv", "tsv", "txt", "json", "jsonl", "md", "html", "xml", "sql"].contains(&ext.as_str()) {
        return Err("Exports can only be saved as .csv, .tsv, .txt, .json, .jsonl, .md, .html, .xml or .sql files.".into());
    }
    tokio::fs::write(p, contents.as_bytes()).await.map_err(err)
}

/// Size of the workspace folder on disk (offline copies of attachments).
#[tauri::command]
fn workspace_size(state: State<'_, AppState>) -> u64 {
    fn walk(p: &Path) -> u64 {
        let Ok(rd) = std::fs::read_dir(p) else { return 0 };
        rd.flatten()
            .map(|e| match e.file_type() {
                Ok(t) if t.is_dir() => walk(&e.path()),
                Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
                Err(_) => 0,
            })
            .sum()
    }
    walk(&state.workspace)
}

// ---------------------------------------------------------------------------------------------- secure storage

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(err)
}

#[tauri::command]
fn secure_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(err)?;
    if key == "api_token" {
        *state.token.lock().unwrap() = Some(value);
    }
    Ok(())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secure_delete(state: State<'_, AppState>, key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    if key == "api_token" {
        *state.token.lock().unwrap() = None;
    }
    Ok(())
}

/// Whether an API token is stored (the value itself stays on the Rust side).
#[tauri::command]
fn has_token(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(token(&state)?.is_some())
}

fn token(state: &State<'_, AppState>) -> Result<Option<String>, String> {
    if let Some(t) = state.token.lock().unwrap().clone() {
        return Ok(Some(t));
    }
    let t = secure_get("api_token".into())?;
    *state.token.lock().unwrap() = t.clone();
    Ok(t)
}

// ---------------------------------------------------------------------------------------------- server & network

fn normalise_server(url: &str) -> Result<String, String> {
    let u = url::Url::parse(url.trim()).map_err(|_| "Enter the full address, e.g. https://librarymedicine.online".to_string())?;
    if u.scheme() != "https" && !(u.scheme() == "http" && matches!(u.host_str(), Some("localhost") | Some("127.0.0.1"))) {
        return Err("The server address must start with https://".into());
    }
    Ok(u.as_str().trim_end_matches('/').to_string())
}

#[tauri::command]
fn set_server(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let s = normalise_server(&url)?;
    *state.server.lock().unwrap() = s.clone();
    Ok(s)
}

#[tauri::command]
fn network_status(state: State<'_, AppState>) -> NetworkStatus {
    NetworkStatus { online: state.online.load(Ordering::SeqCst), server: state.server.lock().unwrap().clone() }
}

/// Can we open a TCP connection to the server right now?
fn reachable(server: &str) -> bool {
    let Ok(u) = url::Url::parse(server) else { return false };
    let Some(host) = u.host_str() else { return false };
    let port = u.port_or_known_default().unwrap_or(443);
    let Ok(addrs) = (host, port).to_socket_addrs() else { return false };
    addrs.take(3).any(|a| TcpStream::connect_timeout(&a, Duration::from_secs(4)).is_ok())
}

/// Checks the server every 5 s (every 2 s right after a change) and emits `network-status` when it changes.
fn start_network_monitor(app: AppHandle, online: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut first = true;
        loop {
            let server = app.state::<AppState>().server.lock().unwrap().clone();
            let now = reachable(&server);
            let before = online.swap(now, Ordering::SeqCst);
            if first || before != now {
                let _ = app.emit("network-status", NetworkStatus { online: now, server });
                first = false;
            }
            std::thread::sleep(Duration::from_secs(if before != now { 2 } else { 5 }));
        }
    });
}

#[tauri::command]
fn check_network_now(app: AppHandle, state: State<'_, AppState>) -> NetworkStatus {
    let server = state.server.lock().unwrap().clone();
    let now = reachable(&server);
    let before = state.online.swap(now, Ordering::SeqCst);
    let st = NetworkStatus { online: now, server };
    if before != now {
        let _ = app.emit("network-status", st.clone());
    }
    st
}

fn build_url(state: &State<'_, AppState>, path: &str) -> String {
    let base = state.server.lock().unwrap().clone();
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else {
        format!("{}/{}", base, path.trim_start_matches('/'))
    }
}

fn authorize(rb: reqwest::RequestBuilder, state: &State<'_, AppState>, auth: Option<&str>) -> Result<reqwest::RequestBuilder, String> {
    Ok(match auth.unwrap_or("token") {
        "none" => rb,
        "token" => {
            let t = token(state)?.ok_or("No API token saved. Add your token first.")?;
            rb.bearer_auth(t)
        }
        jwt => rb.bearer_auth(jwt),
    })
}

/// JSON API call. Never fails on HTTP error codes: the status is returned so the UI can explain it.
#[tauri::command]
async fn api_request(state: State<'_, AppState>, req: ApiRequest) -> Result<ApiResponse, String> {
    let url = build_url(&state, &req.path);
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes()).map_err(err)?;
    let mut rb = state.http.request(method, &url).header("Accept", "application/json").header("X-Requested-With", "XMLHttpRequest");
    rb = authorize(rb, &state, req.auth.as_deref())?;
    if let Some(j) = req.json {
        rb = rb.json(&j);
    }
    let res = rb.send().await.map_err(|e| {
        if e.is_timeout() { "The server took too long to answer.".to_string() } else if e.is_connect() { "Cannot reach the server (offline?).".to_string() } else { e.to_string() }
    })?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(err)?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| serde_json::json!({ "raw": text.chars().take(2000).collect::<String>() }));
    Ok(ApiResponse { status, body })
}

/// Downloads an attached file into files\<project>\<uuid>__<name>, checks its SHA-256, returns the local path.
#[tauri::command]
async fn download_attachment(state: State<'_, AppState>, uuid: String, project: String, name: String, sha256: Option<String>) -> Result<String, String> {
    if !is_uuid(&uuid) || !is_uuid(&project) {
        return Err("Invalid file id.".into());
    }
    let dir = state.workspace.join("files").join(&project);
    tokio::fs::create_dir_all(&dir).await.map_err(err)?;
    let dest = dir.join(format!("{}__{}", uuid, safe_name(&name)));
    let part = dir.join(format!("{uuid}.part"));
    let url = build_url(&state, &format!("api/v1/sync/files/{uuid}"));
    let rb = authorize(state.http.get(&url), &state, Some("token"))?;
    let res = rb.send().await.map_err(err)?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&body).ok().and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from)).unwrap_or_else(|| format!("HTTP {code}"));
        return Err(msg);
    }
    let mut file = tokio::fs::File::create(&part).await.map_err(err)?;
    let mut hasher = Sha256::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(err)?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(err)?;
    }
    file.flush().await.map_err(err)?;
    drop(file);
    let got = hex::encode(hasher.finalize());
    if let Some(want) = sha256.filter(|s| !s.is_empty()) {
        if !want.eq_ignore_ascii_case(&got) {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("The downloaded file is damaged (checksum mismatch); it will be downloaded again.".into());
        }
    }
    tokio::fs::rename(&part, &dest).await.map_err(err)?;
    Ok(dest.display().to_string())
}

/// Uploads a file attached offline, keeping its id. Returns the server's JSON answer and status.
#[tauri::command]
async fn upload_attachment(state: State<'_, AppState>, path: String, uuid: String, project: String, variable: String, sha256: String) -> Result<ApiResponse, String> {
    let p = PathBuf::from(&path);
    if !inside(&state.workspace, &p) {
        return Err("Only files inside the workspace can be uploaded.".into());
    }
    let bytes = tokio::fs::read(&p).await.map_err(err)?;
    let fname = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let fname = fname.split_once("__").map(|(_, n)| n.to_string()).unwrap_or(fname);
    let mime = mime_guess::from_path(&p).first_or_octet_stream().essence_str().to_string();
    let part = reqwest::multipart::Part::bytes(bytes).file_name(fname).mime_str(&mime).map_err(err)?;
    let form = reqwest::multipart::Form::new()
        .text("uuid", uuid)
        .text("project", project)
        .text("variable", variable)
        .text("sha256", sha256)
        .part("file", part);
    let url = build_url(&state, "api/v1/sync/files");
    let rb = authorize(state.http.post(&url).header("Accept", "application/json"), &state, Some("token"))?;
    let res = rb.multipart(form).send().await.map_err(err)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(err)?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| serde_json::json!({ "raw": text }));
    Ok(ApiResponse { status, body })
}

// ---------------------------------------------------------------------------------------------- database schema

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "offline store",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS projects (
                uuid TEXT PRIMARY KEY, title TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS forms (
                uuid TEXT PRIMARY KEY, project TEXT NOT NULL, title TEXT NOT NULL, json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS forms_project ON forms(project);
            CREATE TABLE IF NOT EXISTS variables (project TEXT PRIMARY KEY, json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS records (
                uuid TEXT PRIMARY KEY,
                project TEXT NOT NULL,
                form TEXT,
                status TEXT NOT NULL DEFAULT 'complete',
                version INTEGER NOT NULL DEFAULT 0,
                data TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                dirty INTEGER NOT NULL DEFAULT 0,
                sync_error TEXT
            );
            CREATE INDEX IF NOT EXISTS records_project ON records(project, deleted_at);
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL,
                op TEXT NOT NULL,
                project TEXT NOT NULL,
                form TEXT,
                partial INTEGER NOT NULL DEFAULT 0,
                status TEXT,
                data TEXT,
                client_updated_at TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            CREATE INDEX IF NOT EXISTS outbox_uuid ON outbox(uuid);
            CREATE TABLE IF NOT EXISTS files (
                uuid TEXT PRIMARY KEY,
                record TEXT,
                project TEXT NOT NULL,
                variable TEXT,
                name TEXT NOT NULL,
                mime TEXT,
                size INTEGER NOT NULL DEFAULT 0,
                sha256 TEXT,
                local_path TEXT,
                state TEXT NOT NULL,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS files_record ON files(record);
            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, ok INTEGER NOT NULL, summary TEXT NOT NULL
            );
        "#,
    }]
}

// ---------------------------------------------------------------------------------------------- entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().add_migrations(DB_URL, migrations()).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = workspace_root(app.handle());
            if let Err(e) = ensure_workspace(&root) {
                eprintln!("could not create the workspace folder {}: {e}", root.display());
            }
            let http = reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .build()?;
            let online = Arc::new(AtomicBool::new(false));
            app.manage(AppState {
                http,
                server: Mutex::new(DEFAULT_SERVER.to_string()),
                token: Mutex::new(None),
                online: online.clone(),
                workspace: root,
            });
            start_network_monitor(app.handle().clone(), online);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_info,
            open_local,
            reveal_local,
            import_attachment,
            remove_local,
            secure_set,
            secure_get,
            secure_delete,
            has_token,
            set_server,
            network_status,
            check_network_now,
            api_request,
            download_attachment,
            upload_attachment,
            save_export,
            workspace_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Library Medicine desktop app");
}
