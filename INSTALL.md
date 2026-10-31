# Installing Library Medicine Desktop

**Requirements:** Windows 10 or 11 (64-bit). The Microsoft WebView2 runtime is installed automatically if it is missing.

## Which file?
- **`Library Medicine_…_x64-setup.exe`** — recommended. Guided installer with a language choice, install-for-me or all-users choice, folder choice and shortcuts.
- **`Library Medicine_…_x64_en-US.msi`** — for IT departments (group policy, managed deployment).

## Steps (setup.exe)
1. Double-click the file. If Windows SmartScreen says "Windows protected your PC", choose **More info → Run anyway**. (The installer is not code-signed yet.)
2. Choose the language (English or French).
3. **Welcome → Before you install:** read the notes and choose **I accept**.
4. Choose **Install just for me** (no administrator needed) or **for all users** (asks for administrator permission).
5. Choose the folder, then **Install**.
6. On the last page keep **Run Library Medicine** ticked and, if you want, **Create a desktop shortcut**, then **Finish**.
7. In the app: **Sign in → Connect (paste your API token) → a short setup** (theme, sync, where your files are kept) → **Start working**.

## Updating
Run the newer installer over the old one. Your offline records, settings and sign-in are kept.

## Uninstalling
Windows **Settings → Apps → Library Medicine → Uninstall**. Tick **Delete the application data** only if you also want to remove the offline copy of your data. Anything already synced to librarymedicine.online is not affected. Sign out in the app first if you do not want to leave an offline copy on a shared computer.

## For IT (silent install)
- NSIS: `"Library Medicine_1.2.0_x64-setup.exe" /S` (add `/D=C:\Apps\LibraryMedicine` as the last argument to choose the folder)
- MSI: `msiexec /i "Library Medicine_1.2.0_x64_en-US.msi" /qn`

## Check the download
`SHA256SUMS.txt` lists the SHA-256 of each installer. In PowerShell: `Get-FileHash "Library Medicine_1.2.0_x64-setup.exe"`.
