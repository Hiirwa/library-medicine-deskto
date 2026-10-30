# Library Medicine Desktop

An offline-first Windows app for **librarymedicine.online**. Researchers and data collectors can work on their project records without internet, and attach files. Every change is saved on the computer, timestamped and queued. The app syncs with the website automatically as soon as it can reach the server.

- **Desktop:** Tauri 2 (Rust) + React 18 + TypeScript + Vite + Tailwind CSS 4
- **Local data:** SQLite (`tauri-plugin-sql`) with TanStack Query on top
- **Secrets:** Windows Credential Manager (`keyring` crate)
- **Server:** the existing CodeIgniter 4 platform, with the new sync endpoints described below

---

## What's new in 1.2

- **Sign-in** redesigned: split layout with rotating feature highlights, show/hide password, Caps Lock hint, remembered email, server address with a connection test, setup progress.
- **Connect this computer** is now an interactive guide: expandable steps with progress bar, live token checks, paste button, troubleshooting answers.
- **Help** has a searchable, topic-filtered FAQ and a tour of the project areas.
- **Project:** richer Overview (health checklist, data-quality ring, shortcuts), Variables (type chart, filters, completeness) and Forms (progress, structure preview).
- **Analysis (new):** Statistics, Workbench (frequencies, descriptives, cross-tab with chi-square, ANOVA, correlation with regression), Dashboard (customisable live charts), Reports (print/PDF, HTML, Markdown; pin results from Statistics and Workbench).
- **Data management:** Data view with row selection, bulk export/delete and date filter; new Import wizard (CSV/TSV/JSON with column matching and row checks) and Export centre (CSV labels/codes, JSON, codebook, data package).
- **Import:** Excel (.xlsx), OpenDocument (.ods), CSV/TSV/TXT, JSON, JSONL, XML, HTML and Markdown tables, or pasted cells; sheet picker and remembered column matching.
- **Export:** CSV (labels or codes), Excel spreadsheet (.xml), TSV, JSON, JSON Lines, XML, HTML, SQL, codebook and data package.
- **Smooth loading:** skeleton placeholders, tabs loaded on demand and preloaded when idle, deferred search, fade-in pages and charts (respects reduced-motion).
- **Design:** every text, icon and card carries a shadow; no borders anywhere (`src/pro.css`).
- `src-tauri/src/lib.rs` now also allows saving `.html` exports. Rebuild the installers (GitHub Action "Build Windows installer") to ship this version.

---

## What's new in 1.1.0

**Same design as librarymedicine.online.** The app now uses the website's design system (`brand.css`): Roboto Condensed, brand blue + clinical teal, borderless cards separated by shadows, the same sidebar with the logo, project card, section labels and user menu, the same breadcrumb top bar, page heads, stat tiles and data table. Light and dark themes follow the website (or Windows).

**New features**
- **My projects dashboard**, like the website home: greeting, quick actions, stat tiles (active projects, records, new this week, waiting to send), a 14-day records chart, project search, sort and filters.
- **Project pages** in the sidebar: Overview (completeness, submissions chart, recent activity), Data, Variables, Forms and Files.
- **Data table**: search all columns (`/`), choose columns, labels or codes, compact rows, status tiles (all, complete, drafts, flagged, to send, today), sorting and paging.
- **Export** of the records on this computer to **CSV** (labels or codes) and the **codebook**, saved where you choose.
- **Record editor** rebuilt as a drawer: section list with a step indicator, an answered-progress bar, *Duplicate* (new record with the same answers), **Ctrl+S** to save, personal-data and calculated-field markers, GPS fields can use this computer's location.
- **Command palette** (**Ctrl+K**): jump to any project, page or record. Shortcuts: Ctrl+N new record, Ctrl+B hide the menu, Esc close.
- **Sync centre**: what is waiting to be sent, files to upload or download, records refused by the server with the reason, and the sync history.
- **Settings**: theme, automatic sync interval, sync on start, attachment downloads on/off, storage used on this computer, account and API-token actions.
- **Help & documentation** page with offline steps and shortcuts.
- Status bar on every page: last sync, waiting to send, files offline, auto-sync interval.

---

## 1. What the app does

| Screen | What happens |
|---|---|
| **1. Sign in** | Email/username + password (+ 2-factor code when enabled) against `POST /api/v1/auth/login`. The short-lived session token (JWT) only proves who you are; it is never stored. |
| **2. Connect this computer** | Step-by-step instructions to create a personal API token on the website (Account & security → API tokens). The pasted token is checked with `GET /api/v1/me`. It must belong to the person who signed in and allow writing. It is then stored in the Windows Credential Manager. |
| **3. Workspace** | Projects, records (search, status, sync state), a record editor laid out like the web form, attachments, online/offline badge, *Sync now*, last sync, items waiting to be sent, files available offline. |

**Offline.** Creating, reading, editing, deleting and attaching all work without internet. Each change is written to the local `records` table and appended to the `outbox` change log with a UTC timestamp (ms).

**Files.** Every attachment the person can access is downloaded to `Documents\Library Medicine\files\<project>\`. Files attached offline are copied to `outbox-files\` and uploaded at the next sync. The app keeps the file id it gave them, so records can point to the file before it reaches the server.

**Syncing.** A Rust background thread checks every 5 seconds whether the server is reachable (a TCP connection, not just "Wi-Fi on"). When the connection comes back, the app syncs at once, then every 5 minutes. During a sync an overlay pauses input, so the local database is never edited mid-merge.

**Scope.** Projects, forms and variables are designed on the website. The app downloads them and uses them read-only. Records and attachments are fully editable offline.

---

## 2. Directory layout

```
library-medicine-desktop/
├── .github/workflows/build-windows.yml   CI: builds the .exe/.msi on GitHub's Windows machines
├── app-icon.png                          source for all icons (npm run icons)
├── index.html
├── package.json / package-lock.json      exact versions
├── tsconfig.json, tsconfig.app.json, tsconfig.node.json
├── vite.config.ts                        port 1420, Tailwind plugin, WebView2 target
├── src/
│   ├── main.tsx                          React entry
│   ├── App.tsx                           picks the screen: login → token → workspace
│   ├── styles.css                        Tailwind 4 + Library Medicine styles (shadows, no borders)
│   ├── providers/AppProvider.tsx         QueryClient, session, network → sync triggers, toasts
│   ├── hooks/useNetwork.ts               listens to the Rust "network-status" event
│   ├── lib/
│   │   ├── types.ts                      API + local types
│   │   ├── native.ts                     typed wrappers of the Rust commands
│   │   ├── db.ts                         SQLite store: records, outbox, files, meta, settings
│   │   ├── sync.ts                       the sync engine (push, merge, pull, files)
│   │   └── time.ts                       UTC timestamps, ids, formatting
│   ├── providers/UiProvider.tsx          navigation, theme, editor and palette state
│   ├── lib/csv.ts, lib/format.ts         CSV/codebook export, value labels
│   ├── views/
│   │   ├── LoginView.tsx                 screen 1
│   │   ├── TokenView.tsx                 screen 2
│   │   ├── HomeView.tsx                  My projects dashboard
│   │   ├── ProjectView.tsx               project overview
│   │   ├── DataView.tsx                  data table, export
│   │   ├── VariablesView.tsx, FormsFilesViews.tsx
│   │   ├── SyncView.tsx                  sync centre
│   │   ├── SettingsView.tsx, HelpView.tsx
│   └── components/
│       ├── Shell.tsx                     sidebar, top bar, status bar (website layout)
│       ├── ui.tsx                        page head, stat tiles, cards, charts, icons
│       ├── CommandPalette.tsx            Ctrl+K search
│       ├── RecordEditor.tsx              drawer editor with sections, progress, duplicate
│       ├── FieldInput.tsx                one input per variable type
│       ├── SyncOverlay.tsx               freezes input during sync, shows progress
│       ├── Toasts.tsx, Brand.tsx
└── src-tauri/
    ├── Cargo.toml / Cargo.lock
    ├── build.rs
    ├── tauri.conf.json                   window, CSP, NSIS + MSI bundles, WebView2 bootstrapper
    ├── capabilities/default.json         least-privilege permissions for the window
    ├── icons/                            generated from app-icon.png
    └── src/
        ├── main.rs
        └── lib.rs                        workspace folder, keyring, HTTP, files, network monitor, SQLite schema
```

---

## 3. Sync protocol (server ↔ app)

**Endpoints.** All are authenticated with `Authorization: Bearer rdp_…` (a personal API token):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/sync` | Push the change log and pull everything changed since `last_sync` |
| `POST` | `/api/v1/sync/files` | Upload an attachment made offline (multipart: `file`, `uuid`, `project`, `variable`, `sha256`) |
| `GET` | `/api/v1/sync/files/{uuid}` | Download an attachment (decrypted; `X-File-Sha256` header) |

**Request:**

```json
{
  "last_sync": "2026-10-30T12:00:00.000Z",
  "cursor": null,
  "device": "desktop:3f6e…",
  "changes": [
    { "op": "upsert", "uuid": "…", "project": "…", "form": "…", "partial": true, "status": "draft",
      "data": { "weight_kg": 7.5 }, "client_updated_at": "2026-10-30T09:14:03.120Z" },
    { "op": "delete", "uuid": "…", "client_updated_at": "2026-10-30T09:20:00.000Z" }
  ]
}
```

**Response:**

```json
{
  "server_time": "2026-10-30T12:05:00.481Z",
  "results": [ { "uuid": "…", "status": "applied", "version": 2 },
               { "uuid": "…", "status": "server_wins", "record": { … } },
               { "uuid": "…", "status": "rejected", "error": "Validation failed.", "errors": { "weight_kg": "Must be a number." } } ],
  "meta": { "projects": [ … ], "forms": [ … ], "variables": { "<project>": [ … ] } },
  "records": [ … changed or deleted records … ],
  "files": [ { "uuid": "…", "record": "…", "name": "scan.pdf", "size": 12345, "sha256": "…" } ],
  "has_more": false,
  "cursor": null
}
```

### How the server handles the request

1. The whole change log is applied inside one database transaction. A database error rolls everything back and returns 500; the changes stay queued on the device. A validation problem is reported for that change only and never blocks the others.
2. **New record:** it is validated like a web submission (form scope, study period, plan record limit, duplicate rules). It is then inserted with the id the device created.
3. **Existing record, last write wins:**
   - The server compares the device's `client_updated_at` with the record's own last-write time: `updated_at_utc`, or the deletion time.
   - If the device copy is newer, it overwrites the record and `version_id` goes up.
   - If the server copy is newer, the server copy is returned as `server_wins` and the app overwrites its local copy with it.
   - A device clock set in the future is clamped to the server clock, so a wrong clock cannot win every conflict.
4. **Delete:** a soft delete (`deleted_at` + `deleted_at_utc`). A newer edit can bring a deleted record back.
5. **Delta:**
   - The server returns every record changed since `last_sync`, deletions included, in pages of 1,000 (`has_more` + `cursor`).
   - Changes are found by server receive time, so an old offline edit uploaded late still reaches every other device.
   - The last 2 seconds are sent again, so nothing written in the same second is missed.
   - Changes made on the website are included too.
6. **Same visibility as the REST API:** a personal token only reaches the records its owner submitted. Personal data columns are blanked for roles without access to them.

### How the app commits a sync

The app:
- removes from the outbox what the server applied;
- overwrites what the server won;
- flags refused changes with the reason (the record shows "refused" plus a Dismiss button);
- merges the delta;
- downloads new files;
- only then stores `server_time` from the first page as the new `last_sync`.

### Database columns

The sync tracking columns on `records` are added automatically on the first sync. No migration step is needed.
- `version_id INT`
- `updated_at_utc DATETIME(3)`
- `deleted_at_utc DATETIME(3)`
- an index for the change feed

Existing rows are back-filled.

---

## 4. Server installation (librarymedicine.online)

Upload these files from the website package:

| File | Change |
|---|---|
| `app/Libraries/SyncService.php` | **new**: protocol, conflict rules, delta, schema |
| `app/Controllers/Api/Sync.php` | **new**: `/api/v1/sync`, file upload/download |
| `app/Config/Routes.php` | three routes in the `api/v1` group |
| `app/Libraries/RecordService.php` | keeps a device-made record id; updates the tracking columns on web edits |
| `app/Controllers/Data.php` | a restore from the trash is now seen by devices |

Nothing else is needed: CSRF is already off for `api/*`, and API tokens already exist (Account & security → API tokens, Pro and Max plans).

---

## 5. Build and run on Windows (step by step)

### One-time setup

1. **Microsoft C++ Build Tools.** Install from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and tick **"Desktop development with C++"**.
2. **WebView2.** It is already part of Windows 10 (21H2+) and 11. The installer also downloads it automatically if it is missing.
3. **Rust.** Install from https://rustup.rs, keep the default MSVC toolchain, then in a new terminal:
   ```powershell
   rustup default stable-msvc
   rustc --version
   ```
4. **Node.js 22 LTS.** Install from https://nodejs.org, then:
   ```powershell
   node --version
   ```

### Get the project and install packages

```powershell
cd C:\dev
# copy the library-medicine-desktop folder here (or git clone your repository)
cd library-medicine-desktop
npm ci
```

### Run it in development mode

```powershell
npm run app:dev
```

The first start compiles the Rust part (a few minutes); later starts are fast. The window opens on the sign-in screen.

To test against a local copy of the website, click **Use another server address** and enter e.g. `http://localhost:8080`. Plain `http` is only accepted for `localhost`.

### Test checklist

1. Sign in with your Library Medicine account. If 2-factor is on, the code field appears.
2. On the website, create a token: Account & security → API tokens → **Read & write**. Paste it. The app syncs and lists your projects.
3. Unplug the network (or switch on airplane mode). Within about 5 s the badge says **Offline**.
4. Create a record, edit another, delete one, attach a file. The rows show **to send**, and the footer shows the count waiting.
5. Reconnect. The overlay appears, the changes are sent, and the rows show **synced**. Check the records on the website.
6. Edit the same record on the website and in the app while offline, with the app edit earlier. After the sync the app shows the website's version (last write wins).
7. Open `Documents\Library Medicine\files` (account menu → *Open workspace folder*). The attachments are there.

### Build the installer

```powershell
npm run app:build
```

The outputs are:
- `src-tauri\target\release\bundle\nsis\Library Medicine_1.0.0_x64-setup.exe`: the standard installer. It installs per user, needs no admin rights, and adds a Start-menu entry and an uninstaller.
- `src-tauri\target\release\bundle\msi\Library Medicine_1.0.0_x64_en-US.msi`: for IT departments and Group Policy deployment.

### Or let GitHub build it

Push the folder to a GitHub repository. Then either push a tag `v1.0.0` or open **Actions → Build Windows installer → Run workflow**. The `.exe` and `.msi` appear under the run's **Artifacts**; for a tag, they also appear on a draft Release.

### Code signing (recommended before giving the installer to others)

An unsigned installer triggers the Windows SmartScreen warning ("Windows protected your PC"). To avoid it, buy a code-signing certificate (EV for an immediate reputation). Then add to `src-tauri/tauri.conf.json` under `bundle.windows`:

```json
"certificateThumbprint": "YOUR_CERT_THUMBPRINT",
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com"
```

### New version

Change `version` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then build again. The installer upgrades in place, and local data and the token are kept.

---

## 6. Where things are stored on the PC

| What | Where |
|---|---|
| Records, change log, file list | `%APPDATA%\online.librarymedicine.desktop\library-medicine.db` (SQLite) |
| API token | Windows Credential Manager → *Generic credentials* → `online.librarymedicine.desktop` |
| Attachments | `Documents\Library Medicine\files\<project>\` |
| Files attached offline | `Documents\Library Medicine\outbox-files\` |

**Sign out.** Signing out deletes the token and the local copy. If changes are still waiting, the app first offers to sync.

---

## 7. Troubleshooting

| Message | Meaning / fix |
|---|---|
| "This token is not valid" | It was revoked, expired or mistyped. Create a new token on the website. |
| "This token belongs to …" | The token was created while signed in as someone else. |
| "This token is read-only" | Create a **Read & write** token. |
| A record shows **refused** | The server did not accept the change (e.g. a value of the wrong type, the study period has ended, or the plan's record limit was reached). The reason is shown in the record, and the server copy was kept. |
| Badge stays **Offline** although the internet works | A firewall or proxy blocks `librarymedicine.online:443`. |
| Sync fails with HTTP 503 | The server could not add its sync columns (database permissions). See the website's `writable/logs`. |
