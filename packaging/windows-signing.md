# Windows: signing and the Microsoft Store

The NSIS installer (`Surco-x.y.z-Setup.exe`) ships unsigned, so SmartScreen shows
"Windows protected your PC" to everyone who opens it, and some users stop there.

## Why the Microsoft Store

- **SignPath Foundation** turned Surco down on 22/10/2026. The program wants public
  visibility first (stars, forks, contributors, articles, Reddit or YouTube mentions).
  It can be asked again once Surco has more of that. Their paid plan does not help on its
  own: it still needs a certificate of ours.
- **Azure Artifact Signing** only takes individuals from the US and Canada. In the EU it
  takes organisations with three years of verifiable history. The maintainer is an
  individual in Spain.
- **An OV or EV certificate** puts a name on the warning but does not remove it. Since 2024
  SmartScreen reputation is earned through downloads, EV included.
- **The Microsoft Store** re-signs the package itself, so a Store install shows no warning
  from day one, and registration is free for individuals.

The `.exe` stays. Existing users update through it with electron-updater, and some
machines cannot use the Store. Having both installed at once is not supported: they would
share `%APPDATA%\Surco` while the Store copy lags a version behind during certification.

## The account

Individual Partner Center account, app reserved as **MSIX**.

| Field | Value |
|---|---|
| `Package/Identity/Name` | `VicentGozalbes.Surco` |
| `Package/Identity/Publisher` | `CN=D13B979E-AC81-4811-B7E0-309749169C20` |
| `PublisherDisplayName` | `Vicent Gozalbes` |
| Store ID | `9P8C4M673334` |
| Store page | https://apps.microsoft.com/detail/9P8C4M673334 |
| Entra tenant | `surcoapp.onmicrosoft.com` |
| Entra app for CI | `surco-ci`, role Manager |
| Privacy policy URL | https://getsurco.app/en/privacy |

## The package

`appx:` in `apps/desktop/electron-builder.yml` and the manifest in
`apps/desktop/build/appx-manifest.xml`. Built with
`npx electron-builder --win appx --x64 --publish never`, on Windows only.

The manifest disables AppData write virtualization (`desktop6:FileSystemWriteVirtualization`)
with the restricted capability `unvirtualizedResources`. With the default manifest, writes
to a folder that did not exist before install go to the package's private storage. For a
Store-only user that is `%APPDATA%\Surco` itself, Originals included: Windows deletes it on
uninstall and File Explorer cannot see it. Writes beside rekordbox's `master.db` were never
affected, because that folder already exists. Both were measured in CI, run
https://github.com/surco-app/surco/actions/runs/39805857919.

`toolsets.winCodeSign: "1.1.0"` is needed because the default Windows Kits predate the
`desktop6` schema and `makeappx` rejects the manifest with them.

Inside the package, `process.windowsStore` is true: electron-updater stays off, "Check for
updates" says the Store handles it, and the betas box is locked (`src/main/updateMode.ts`).

## Releases

`.github/workflows/release.yml` builds the `.appx` next to the installer and keeps it as
the `surco-store-appx` artifact. The `store` job then submits it with the Microsoft Store
CLI (`msstore`), but only:

- after `publish`, so the Store never gets a version GitHub never made public;
- on stable tags, never on a beta;
- when the repository variable `STORE_PUBLISH` is `1`.

A submission still in certification is deleted and replaced. The job cannot fail the
release.

`build-test.yml` has a `store` input that builds the same package without a release.

### First submission (by hand)

`msstore` can only update an app that already has a submission, so the first one is made
in Partner Center with the package from a `build-test.yml` or release artifact, and the
listing texts in `packaging/store/listing.md`. Then set `STORE_PUBLISH` to `1` under
Settings, Secrets and variables, Actions, Variables.

## Secrets and their expiry

`PARTNER_CENTER_TENANT_ID`, `PARTNER_CENTER_CLIENT_ID`, `PARTNER_CENTER_CLIENT_SECRET`,
`PARTNER_CENTER_SELLER_ID`.

**The `surco-ci` key expires on 22/10/2028.** From then on the `store` job fails on every
release. To renew it before that date: Partner Center, Account settings, User management,
sign in with the `surcoapp.onmicrosoft.com` admin, Microsoft Entra applications, `surco-ci`,
Add new key. Put the new value in `PARTNER_CENTER_CLIENT_SECRET` and delete the old key.
