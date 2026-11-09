# Browser extension: publishing and one-click install

## Publish a version

```sh
node summer-extension/scripts/pack.mjs https://summer.university.local
```

Writes `summer-extension-dist/` (`summer-extension.crx`, `summer-extension.json`, and the signing key `summer-extension.pem` on first run). summer-server serves it from `EXTENSION_DIR`:

| URL | Auth | Purpose |
| --- | --- | --- |
| `/api/extension/summer-extension.crx` | public | the package, as `application/x-chrome-extension` |
| `/api/extension/updates.xml` | public | update manifest; installed copies auto-update from it |
| `/api/extension` | token | `{ id, version }` for the install page |

Bump `version` in `summer-extension/manifest.json` before re-packing. Keep the `.pem`: a new key means a new extension ID and every user reinstalls.

## Browser policy (once, by IT)

Chrome and Edge only install extensions from their own web stores, unless a policy allows another site. With this policy in place, "הוספה לדפדפן" in Summer opens the browser's "Add extension" dialog; without it, the `.crx` is just downloaded.

**ExtensionInstallSources**: allow Summer's origin (both the `.crx` URL and the page linking to it must match):

```
HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallSources\1  = "https://summer.university.local/*"
HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources\1 = "https://summer.university.local/*"
```

**ExtensionInstallAllowlist**: the extension ID (from `summer-extension.json`). Also required: without it the browser installs the extension but keeps it disabled as "not from the Web Store", with the toggle greyed out.

```
HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist\1  = "<id>"
HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist\1 = "<id>"
```

**Optional: no click at all.** `ExtensionInstallForcelist` installs it for everyone, and users can't remove it:

```
HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist\1 = "<id>;https://summer.university.local/api/extension/updates.xml"
```
