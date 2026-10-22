# Surco en la Microsoft Store: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar Surco gratis en la Microsoft Store, con envío automático en cada release estable, sin que la versión de la Store intente actualizarse sola ni pierda los datos del usuario.

**Architecture:** electron-builder genera un `.appx` x64 con un manifiesto propio (redirección de `AppData` desactivada) junto al `.exe` de siempre. La app detecta `process.windowsStore` y apaga `electron-updater` y la opción de betas. Un job nuevo de `release.yml`, posterior a `publish`, envía el paquete con la CLI `msstore`. La web cambia al final, cuando la ficha ya está publicada.

**Tech Stack:** electron-builder 26.15.3 (target `appx`), Electron 44, GitHub Actions (`microsoft/microsoft-store-apppublisher`), React 19 + Vitest, web Vite + react-i18next en Vercel.

**Spec:** `docs/superpowers/specs/2026-10-22-microsoft-store-design.md`

## Global Constraints

- Identidad del paquete, copiada tal cual: `identityName: VicentGozalbes.Surco`, `publisher: CN=D13B979E-AC81-4811-B7E0-309749169C20`, `publisherDisplayName: Vicent Gozalbes`, `applicationId: Surco`. Store ID `9P8C4M673334`.
- Solo x64. Solo versiones estables (tags sin `-beta.`).
- Manifiesto: `<desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>`, capacidades `runFullTrust` + `unvirtualizedResources`, `MinVersion="10.0.18362.0"`, `MaxVersionTested="10.0.22621.0"`. Exige `toolsets.winCodeSign: "1.1.0"`.
- Idiomas del paquete: `es-ES`, `en-US`, `de-DE`, `fr-FR`, `pt-BR`.
- Secretos: `PARTNER_CENTER_TENANT_ID`, `PARTNER_CENTER_CLIENT_ID`, `PARTNER_CENTER_CLIENT_SECRET`, `PARTNER_CENTER_SELLER_ID`. Variable del repo `STORE_PUBLISH` (el envío solo corre si vale `1`).
- Un fallo de la Store nunca tumba el release.
- Textos de UI, web y docs sin guion largo (—) ni dos puntos de explicación.
- Settings: una opción no aparece ni desaparece; se deshabilita y explica por qué.
- Commits con título descriptivo en inglés, sin cuerpo ni prefijos `feat:`/`fix:`, como el resto del historial.
- Comentarios: el repo comenta el porqué de forma abundante y eso manda dentro del código de Surco (conflicto con la regla global de cero comentarios; se sigue la convención del repo).
- Tests desde el worktree, sin `node_modules` propio: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <fichero>` (igual en `apps/web`). Tipos: `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` y `-p tsconfig.web.json --noEmit`. Nunca `tsc --noEmit` a secas.

## Review Focus

1. **Un usuario de la Store pulsa «Buscar actualizaciones» en el menú.** Debe ver que las actualizaciones llegan por la Store, nunca un error de `electron-updater`. Test en la Tarea 2.
2. **Usuario de la Store con `betaUpdates: true` heredado del `.exe`** (comparten `%APPDATA%\Surco`). La casilla sale marcada pero deshabilitada y el updater no arranca igualmente. Test en la Tarea 2.
3. **Release beta.** No se envía nada a la Store aunque `STORE_PUBLISH` sea `1`. Test en la Tarea 3.
4. **Envío a la Store que falla** (certificación pendiente, credenciales caducadas el 22/10/2028). El release y el job `update-tap` siguen. Test en la Tarea 3.
5. **Visitante con un enlace viejo a `/firma-de-codigo` o `/en/code-signing`.** Llega a la home, no a un 404. Test en la Tarea 4.

---

### Task 1: Paquete de la Store

**Files:**
- Create: `apps/desktop/build/appx-manifest.xml` (plantilla propia; fuera de `build/appx/`, que electron-builder empaqueta entera como recursos gráficos)
- Create: `apps/desktop/build/appx/StoreLogo.png` (50×50), `Square44x44Logo.png` (44×44), `Square150x150Logo.png` (150×150), `Wide310x150Logo.png` (310×150)
- Modify: `apps/desktop/electron-builder.yml` (bloque `appx:` y `toolsets:` de nivel superior)
- Test: `apps/desktop/src/main/storePackage.test.ts`

**Interfaces:**
- Produces: `npx electron-builder --win appx --x64 --publish never` genera `apps/desktop/dist/Surco-<version>-Setup.appx` sin firmar (lo firma Microsoft). La Tarea 3 usa ese comando y ese nombre.

- [ ] **Step 1: Write the failing test** `storePackage.test.ts`, leyendo ficheros con `readFileSync` como `electronVersionPin.test.ts`:
  - `it('declares the identity Partner Center reserved, or the Store rejects every upload')`: el yml contiene `identityName: VicentGozalbes.Surco`, `publisher: CN=D13B979E-AC81-4811-B7E0-309749169C20`, `publisherDisplayName: Vicent Gozalbes` y `customManifestPath: appx-manifest.xml`.
  - `it('keeps AppData writes unredirected, or a Store-only user loses their Originals on uninstall')`: el manifiesto contiene `<desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>`, `Name="unvirtualizedResources"`, `Name="runFullTrust"` y `MinVersion="10.0.18362.0"`.
  - `it('packs with Windows Kits new enough to read desktop6, or makeappx rejects the manifest')`: el yml contiene `winCodeSign: "1.1.0"`.
  - `it('ships Surco tiles, or the Store shows Electron sample logos')`: existen los cuatro PNG de `build/appx/`.
- [ ] **Step 2: Run** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/storePackage.test.ts` desde `apps/desktop`. Expected: FAIL en los cuatro.
- [ ] **Step 3: Implement.**
  - Manifiesto: copia `packaging/store-probe/unvirtualized.appxmanifest.xml` de la rama `spike/store-probe` (`git show spike/store-probe:packaging/store-probe/unvirtualized.appxmanifest.xml`). Ya está probado en CI (run 39805857919).
  - `electron-builder.yml`: `appx:` con la identidad de Global Constraints, `applicationId: Surco`, `displayName: Surco`, `languages` con los cinco tags, `customManifestPath: appx-manifest.xml`, `backgroundColor` el del icono. `toolsets: { winCodeSign: "1.1.0" }` a nivel superior. No tocar `win.target` (sigue `nsis`; el appx se pide por CLI).
  - Iconos desde `build/icon.png` (1024×1024) con `sips -z` en macOS; el ancho con `sips -z 150 150` y luego `--padToHeightWidth 150 310`.
- [ ] **Step 4: Run** el test. Expected: PASS.
- [ ] **Step 5: Comprobar que el `.exe` no cambia.** `git diff apps/desktop/electron-builder.yml` no toca `win:` ni `nsis:`. El `.appx` solo se puede generar en Windows; su verificación real es el Step 5 de la Tarea 3.
- [ ] **Step 6: Commit** `git commit -m "Package Surco for the Microsoft Store with AppData writes unredirected"`

### Task 2: La app de la Store no se actualiza sola

**Files:**
- Create: `apps/desktop/src/main/updateMode.ts`, `apps/desktop/src/main/updateMode.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (`checkForUpdates` hacia la línea 502; bloque `if (app.isPackaged)` hacia la 1722)
- Modify: `apps/desktop/src/main/i18n.ts` (clave `updatesFromStore` en es, en, de, fr, pt-BR)
- Modify: `apps/desktop/src/preload/api.ts:84` y `apps/desktop/src/preload/index.ts:67` (`storeBuild`)
- Modify: `apps/desktop/src/renderer/src/lib/platform.ts`, `apps/desktop/src/renderer/src/test/api.ts`
- Modify: `apps/desktop/src/renderer/src/components/settings/GeneralTab.tsx:229-237`, locales `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (clave `settings.betaUpdatesStoreHint`)
- Test: `apps/desktop/src/renderer/src/components/settings/GeneralTab.test.tsx`

**Interfaces:**
- Produces: `export type UpdateMode = 'dev' | 'store' | 'updater'` y `export function updateMode(env: { packaged: boolean; windowsStore: boolean }): UpdateMode` en `updateMode.ts`.
- Produces: `Api.storeBuild: boolean` (preload) y `isStoreBuild(): boolean` en `renderer/src/lib/platform.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `updateMode.test.ts`: `updateMode({ packaged: false, windowsStore: false })` → `'dev'`; `({ packaged: true, windowsStore: true })` → `'store'`; `({ packaged: true, windowsStore: false })` → `'updater'`. Nombre del test que explique el porqué: la Store instala en una carpeta de solo lectura y `electron-updater` no puede sustituirla.
  - `GeneralTab.test.tsx`: con `window.api.storeBuild = true` y `betaUpdates: true`, `getByTestId('settings-beta-updates')` sigue en el documento, está deshabilitado y el hint muestra el texto de `settings.betaUpdatesStoreHint`. Con `storeBuild = false`, habilitado como hoy.
- [ ] **Step 2: Run** ambos ficheros. Expected: FAIL (`updateMode` no existe; `storeBuild` no está en el mock).
- [ ] **Step 3: Implement.**
  - `updateMode.ts` con la firma de Interfaces.
  - `index.ts`: `checkForUpdates` usa `updateMode({ packaged: app.isPackaged, windowsStore: process.windowsStore === true })`; `'dev'` mantiene `updatesDevOnly`, `'store'` muestra un diálogo info con `t('updatesFromStore')`. El bloque de arranque del updater solo corre en `'updater'`.
  - `i18n.ts`: `updatesFromStore` en los cinco idiomas. es: «Esta copia de Surco viene de la Microsoft Store y se actualiza desde allí.» en: «This copy of Surco comes from the Microsoft Store and updates through it.» de/fr/pt-BR, traducción equivalente.
  - Preload: `storeBuild: process.windowsStore === true`. Mock de tests: `storeBuild: false`.
  - `GeneralTab.tsx`: `disabled={isStoreBuild()}` y, en ese caso, `hint={tr('settings.betaUpdatesStoreHint')}`. es: «Las versiones de prueba solo llegan al instalador descargado desde la web. Esta copia se actualiza desde la Microsoft Store.» en y resto, equivalente.
- [ ] **Step 4: Run** los dos tests, después la suite de `apps/desktop` entera y los dos `tsc -p` de Global Constraints. Expected: todo PASS, cero errores de tipos.
- [ ] **Step 5: Commit** `git commit -m "Leave updates to the Microsoft Store when Surco runs from its package"`

### Task 3: Envío automático en el release

**Files:**
- Modify: `.github/workflows/release.yml` (paso «Build & publish (Windows)» línea 300; job nuevo `store` después de `publish`, línea ~436)
- Modify: `.github/workflows/build-test.yml` (input booleano `store`, paso que genera el `.appx` y lo sube como artefacto)
- Test: `apps/desktop/src/main/storeRelease.test.ts`

**Interfaces:**
- Consumes: comando y nombre de fichero de la Tarea 1.
- Produces: artefacto `surco-store-appx` en cada release (y en `build-test.yml` con `store: true`).

- [ ] **Step 1: Write the failing test** `storeRelease.test.ts`, leyendo `../../../../.github/workflows/release.yml` como texto y aislando el bloque del job `store:` por regex:
  - `it('submits to the Store only after the release is public, so the Store never gets a build GitHub withdrew')`: el bloque contiene `needs:` con `publish`.
  - `it('never sends a beta to the Store')`: el `if:` contiene `!contains(github.ref_name, '-beta.')`.
  - `it('stays off until the first submission is made by hand')`: el `if:` contiene `vars.STORE_PUBLISH == '1'`.
  - `it('cannot fail the release')`: el bloque contiene `continue-on-error: true` y `update-tap` no lista `store` en sus `needs`.
  - `it('builds the Store package next to the installer')`: el paso de Windows contiene `--win appx` y `actions/upload-artifact` con `name: surco-store-appx`.
- [ ] **Step 2: Run** el test. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Paso de Windows: tras el `nsis` actual, `npx electron-builder --win appx --x64 --publish never` y `actions/upload-artifact@v4` con `name: surco-store-appx`, `path: apps/desktop/dist/*.appx`. Si el paso del appx falla, el `.exe` ya está subido; marcar el paso con `continue-on-error: true`.
  - Job `store`: `needs: publish`, `runs-on: windows-latest`, `if: ${{ !contains(github.ref_name, '-beta.') && vars.STORE_PUBLISH == '1' }}`, `continue-on-error: true`. Pasos: `actions/download-artifact@v4` (`surco-store-appx`), `microsoft/microsoft-store-apppublisher@v1.1`, `msstore reconfigure --tenantId … --sellerId … --clientId … --clientSecret …` con los cuatro secretos, borrar el envío pendiente si lo hay (`msstore submission status 9P8C4M673334` y, si está en curso, `msstore submission delete 9P8C4M673334`; confirmar los flags exactos con `msstore submission --help` en el primer run y dejarlos fijados), y `msstore publish <appx> -id 9P8C4M673334`. Escribir el resultado en `$GITHUB_STEP_SUMMARY`.
  - `build-test.yml`: input `store` (boolean, default false); si es true, el mismo comando appx y el mismo artefacto.
  - El workflow se sube por SSH (el token de `gh` no tiene scope `workflow`).
- [ ] **Step 4: Run** el test. Expected: PASS.
- [ ] **Step 5: Verificación real.** Requiere subir la rama `store-msix` a GitHub. **Pedir permiso a Vicent antes del push.** Después `gh workflow run build-test.yml --ref store-msix -f ref=store-msix -f store=true`. Expected: run verde, artefacto `surco-store-appx` con `Surco-1.10.0-Setup.appx` dentro. Descargarlo y comprobar con `unzip -p <appx> AppxManifest.xml` que lleva la identidad de Global Constraints y `FileSystemWriteVirtualization` a `disabled`.
- [ ] **Step 6: Commit** `git commit -m "Send each stable release to the Microsoft Store once the first submission exists"`

### Task 4: Retirar la página de SignPath

**Files:**
- Delete: `apps/web/src/components/CodeSigning.tsx`, `apps/web/src/i18n/codeSigning.test.ts`
- Modify: `apps/web/src/routes.tsx` (import línea 10, ruta línea 34, `CodeSigningHead` 285-305, `LocalizedCodeSigning` 307+, ruta `en/code-signing` 376), `apps/web/src/lib/nav.ts:12`, `apps/web/src/lib/sitemap.ts:25`, `apps/web/public/sitemap.xml:43`, `apps/web/src/components/Footer.tsx:13,120-124`, `apps/web/src/i18n/locales/{es,en}.json` (bloque `codeSigning` y `footer.codeSigning`), `apps/web/vercel.json`
- Test: `apps/web/src/lib/redirects.test.ts`

- [ ] **Step 1: Write the failing test** `redirects.test.ts`: lee `vercel.json` y espera redirecciones `/firma-de-codigo` → `/` y `/en/code-signing` → `/en`, ambas `permanent: true`. Nombre: la URL se dio a SignPath en la solicitud y puede estar enlazada.
- [ ] **Step 2: Run** desde `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement.** `redirects` en `vercel.json` y borrado de todo lo listado. `keys.test.ts` y `npm run build -w apps/web` deben seguir verdes sin claves huérfanas (`codeSigning` desaparece de es y en a la vez).
- [ ] **Step 4: Run** la suite de `apps/web`, `npm run typecheck -w apps/web` y `npm run build -w apps/web`. Expected: verde; `grep -rn "SignPath\|code-signing\|firma-de-codigo" apps/web/src apps/web/public` solo encuentra `vercel.json`.
- [ ] **Step 5: Commit** `git commit -m "Take down the code signing policy page now that SignPath does not sign Surco"`

### Task 5: Documentación y textos para Partner Center

**Files:**
- Modify: `packaging/windows-signing.md` (reescrito)
- Create: `packaging/store/listing.md`

- [ ] **Step 1: Reescribir `packaging/windows-signing.md`.** Contenido: por qué la Store (SmartScreen, rechazo de SignPath del 22/10 por visibilidad y cuándo volver a pedirlo, Azure solo para particulares de EE. UU./Canadá, OV/EV no quitan el aviso); tabla de identidad y tenant `surcoapp.onmicrosoft.com` con la app `surco-ci` (rol Manager); los cuatro secretos y **la caducidad de la clave el 22/10/2028** con cómo renovarla (Partner Center, User management, Microsoft Entra applications, `surco-ci`, Add new key, actualizar `PARTNER_CENTER_CLIENT_SECRET`, borrar la vieja); qué es `STORE_PUBLISH` y cuándo se activa; por qué el manifiesto desactiva la redirección (run 39805857919).
- [ ] **Step 2: Crear `packaging/store/listing.md`.** Por idioma (es, en, de, fr, pt-BR): descripción corta, descripción larga, 5-8 características, palabras clave, sacado de `apps/web/src/i18n/locales/{es,en}.json` (hero y funciones) y traducido para de/fr/pt-BR. Además, en inglés, la justificación de `unvirtualizedResources`: «Surco edits the user's DJ libraries in place (rekordbox keeps its collection under %APPDATA%\Pioneer) and keeps copies of the user's original audio files under %APPDATA%\Surco so they can be restored. With write virtualization these copies would be deleted on uninstall and would be invisible to File Explorer.» Y la lista de capturas a preparar (con la pista de referencia de siempre).
- [ ] **Step 3: Revisar** que ningún texto lleva guion largo ni dos puntos de explicación: `grep -n "—" packaging/windows-signing.md packaging/store/listing.md` vacío.
- [ ] **Step 4: Commit** `git commit -m "Document the Microsoft Store route and draft its Partner Center listing"`

### Task 6 (bloqueada hasta que la ficha de la Store esté publicada): Botón de la Store en la web

**Files:**
- Modify: `apps/web/src/components/DownloadButton.tsx` (rama `os === 'windows'`, líneas 208-217 y donde se pinta el botón)
- Modify: `apps/web/src/i18n/locales/{es,en}.json` (`download.store`, `download.exeLink`, `download.exeUninstallFirst`, FAQ de SmartScreen línea ~531)
- Test: `apps/web/src/components/DownloadButton.test.tsx`

- [ ] **Step 1: Boceto.** Artifact dibujado del botón de Windows con el enlace secundario al `.exe` y su aviso, en claro y oscuro. Esperar el visto bueno de Vicent antes de seguir; lo que diga sustituye a los pasos siguientes donde choque.
- [ ] **Step 2: Write the failing test.** Con `detectOS` → `'windows'`: el botón principal (`data-testid` existente del CTA) apunta a `https://apps.microsoft.com/detail/9P8C4M673334`; existe `data-testid="download-exe"` con el `href` del instalador; `download-smartscreen` y `data-testid="download-exe-uninstall"` están junto a `download-exe`. Con `'mac'`, nada de esto aparece.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** según el boceto aprobado. La FAQ de SmartScreen nombra la Store como la forma sin avisos y explica que, para pasar del `.exe` a la Store, se desinstala antes el `.exe` y los datos se conservan.
- [ ] **Step 5: Run** suite web, typecheck y build. Captura con `vite preview` (no dev) en Windows simulado para comprobar el resultado.
- [ ] **Step 6: Commit** `git commit -m "Point Windows visitors at the Microsoft Store and keep the installer one click away"`

## Fuera del código (Vicent)

- Primera publicación en Partner Center con el artefacto `surco-store-appx`: justificación de `unvirtualizedResources` y fichas de `packaging/store/listing.md`, capturas, clasificación por edades, **política de privacidad** (la web no tiene página de privacidad; la Store la pide si la app usa Internet, y Surco consulta Discogs: hay que decidir dónde vive) y precio gratis.
- Al publicarse: variable `STORE_PUBLISH=1` en el repo y desbloquear la Tarea 6.
- Una prueba con rekordbox real desde la versión de la Store, por parte de un usuario de Windows.
- Borrar la rama `spike/store-probe` (local y remota) y el worktree `../surco-store-probe`.
