# winget manifests

Manifest trio for [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), kept here
until the Windows installer is code-signed — submitting an unsigned installer works, but
SmartScreen still fires on first launch and reviews flag it, so the listing lands better
once signing ships.

To submit (from any machine with [komac](https://github.com/russellbanks/Komac)):

```bash
komac submit --identifier SurcoApp.Surco --version <VERSION> \
  --urls https://github.com/surco-app/surco-releases/releases/download/v<VERSION>/Surco-<VERSION>-Setup.exe
```

or copy these three files to `manifests/s/SurcoApp/Surco/<VERSION>/` in a winget-pkgs fork and
open the PR. For a new version, update `PackageVersion`, the `InstallerUrl` and the
`InstallerSha256` (`shasum -a 256 Surco-<VERSION>-Setup.exe`, uppercase).
