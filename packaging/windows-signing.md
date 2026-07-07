# Windows code signing (Azure Trusted Signing)

The Windows installer ships unsigned today, so SmartScreen interrupts every first
launch ("Windows protected your PC") and the web FAQ has to teach the workaround.
Azure Trusted Signing is the cheapest managed route (~$9.99/month, Basic tier):
Microsoft issues short-lived certificates from an HSM, electron-builder 26 supports
it natively, and signed installers stop triggering SmartScreen once the certificate
accrues a little reputation.

## One-time setup (needs the account owner)

1. **Azure account + subscription** at portal.azure.com (a free account works; the
   Trusted Signing resource itself bills to the subscription).
2. **Create a Trusted Signing account**: search "Trusted Signing Accounts" → Create.
   Pick region *West Europe*, SKU *Basic*. Name e.g. `surco-signing`.
3. **Identity validation** (inside the resource → Identity validations → New →
   *Individual*): passport/ID check for "Vicent Gozalbes". This is the step with
   human latency — hours to a few days.
4. **Certificate profile** (resource → Certificate profiles → Create → *Public Trust*):
   name e.g. `surco`, link it to the identity validation. The certificate's CN becomes
   the publisher name shown by Windows.
5. **App registration** for CI: Microsoft Entra ID → App registrations → New →
   `surco-ci-signing`. Create a client secret. On the Trusted Signing account (IAM),
   grant this app the **Trusted Signing Certificate Profile Signer** role.
6. **GitHub Actions secrets** (in the `surco` repo):
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID` (the app registration's Application ID)
   - `AZURE_CLIENT_SECRET`

## Wiring (apply once the secrets exist — the build FAILS if they are set in the
## config but missing in the environment, so do not merge this ahead of step 6)

`apps/desktop/electron-builder.yml` — add under `win:`:

```yaml
win:
  icon: build/icon.ico
  target:
    - nsis
  artifactName: ${productName}-${version}-Setup.${ext}
  azureSignOptions:
    endpoint: https://weu.codesigning.azure.net
    codeSigningAccountName: surco-signing
    certificateProfileName: surco
```

`.github/workflows/release.yml` — the Windows build step gets the credentials
(remember: the gh token cannot push workflow files; push this via SSH):

```yaml
      - name: Build & publish (Windows)
        if: runner.os == 'Windows'
        working-directory: apps/desktop
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
        run: |
          npx electron-vite build
          npx electron-builder --win --publish always
```

electron-builder detects `azureSignOptions` and signs both the app binaries and the
NSIS installer through the `Invoke-TrustedSigning` PowerShell module (it installs it
on the runner automatically; windows-latest already carries the .NET runtime it needs).

## After the first signed release

- Verify: download the Setup.exe, right-click → Properties → Digital Signatures.
- Update the web FAQ (the SmartScreen answer in `apps/web/src/i18n/locales/*.json`)
  to say Windows builds are signed — and drop the "Run anyway" instructions.
- Submit the winget manifests (see `packaging/winget/README.md`).
- SmartScreen reputation builds over downloads; the warning can still appear for the
  first days after a brand-new certificate. That is expected and fades.
