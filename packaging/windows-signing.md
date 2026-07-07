# Windows code signing

The Windows installer ships unsigned today, so SmartScreen interrupts every first
launch ("Windows protected your PC") and the web FAQ has to teach the workaround.

## Plan: SignPath Foundation (free for open source)

[SignPath Foundation](https://signpath.org/) signs open-source projects at no cost,
with their own established certificate — which means SmartScreen reputation comes
with it instead of accruing over months like a brand-new certificate would. Surco
qualifies: OSI license (GPL-3.0), public codebase, active maintenance, released
builds, and a verifiable GitHub Actions pipeline.

Trade-offs to know before applying:

- The signature's publisher reads **"SignPath Foundation"**, not the maintainer's name.
- Every release needs a **manual approval** in their dashboard before it is signed.
- Builds must come from the connected CI pipeline (ours already do), and the project
  must stay fully open source.

### Steps (account owner)

1. Apply at signpath.org (Get started → open-source application): project URL
   `https://github.com/vigosan/surco`, license GPL-3.0, download page
   `https://www.getsurco.app/`, artifacts = NSIS installer built by
   `.github/workflows/release.yml`. Review takes days to a few weeks.
2. Once approved, SignPath provisions an organization + project; create a CI user
   and store its API token as the `SIGNPATH_API_TOKEN` GitHub Actions secret.
3. Tell the agent — the release workflow then needs a signing step between build and
   publish: electron-builder packs without publishing, the unsigned Setup.exe goes to
   SignPath (their `signpath/github-action-submit-signing-request` action), the signed
   artifact replaces it, `latest.yml`'s sha512/size are recomputed for the signed file
   (electron-updater verifies that hash), and only then are the assets uploaded to the
   release. The workflow edit is pushed over SSH (the gh token lacks workflow scope).

### After the first signed release

- Verify: download the Setup.exe → Properties → Digital Signatures ("SignPath Foundation").
- Update the web FAQ (the SmartScreen answer in `apps/web/src/i18n/locales/*.json`).
- Submit the winget manifests (see `packaging/winget/README.md`).

## Paid alternative (kept for reference)

Azure Trusted Signing (~$9.99/month, publisher = your own validated name) is the
managed route if the Foundation application is declined or the per-release approval
becomes a burden: create a Trusted Signing account (West Europe, Basic), pass
Individual identity validation, create a Public Trust certificate profile, register a
CI app with the *Trusted Signing Certificate Profile Signer* role, set
`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` as Actions secrets, and
add under `win:` in `apps/desktop/electron-builder.yml`:

```yaml
  azureSignOptions:
    endpoint: https://weu.codesigning.azure.net
    codeSigningAccountName: surco-signing
    certificateProfileName: surco
```

plus the three `AZURE_*` env vars on the Windows build step in `release.yml`. Note a
brand-new certificate still triggers SmartScreen until it earns reputation.
