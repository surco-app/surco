# winget manifests

Manifest trio for [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), first
submitted with v1.8.2 while the Windows installer is still unsigned. winget-pkgs only accepts
schema 1.10.0 or 1.12.0.

To submit (from any machine with [komac](https://github.com/russellbanks/Komac)):

```bash
komac submit --identifier SurcoApp.Surco --version <VERSION> \
  --urls https://github.com/surco-app/surco-releases/releases/download/v<VERSION>/Surco-<VERSION>-Setup.exe
```

or copy these three files to `manifests/s/SurcoApp/Surco/<VERSION>/` in a winget-pkgs fork and
open the PR. For a new version, update `PackageVersion`, the `InstallerUrl` and the
`InstallerSha256` (`shasum -a 256 Surco-<VERSION>-Setup.exe`, uppercase).
