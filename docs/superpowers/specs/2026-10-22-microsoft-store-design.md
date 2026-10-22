# Surco en la Microsoft Store

Estado: diseño aprobado por Vicent en conversación (22/10), pendiente de plan.

## Por qué

El instalador de Windows (`Surco-x.y.z-Setup.exe`, NSIS) va sin firmar. SmartScreen enseña
«Windows protegió tu PC» a todo el que lo abre y hay usuarios que no saben pasar de ahí.

Las vías de firma se han descartado una a una:

- **SignPath Foundation** rechazó a Surco (correo del 22/10) por falta de visibilidad pública.
  Se puede volver a pedir cuando haya más tracción.
- **Azure Artifact Signing** solo admite particulares de EE. UU. y Canadá. Vicent es particular
  en España y no tiene empresa.
- **Un certificado OV o EV** pone el nombre en el aviso pero no lo quita: desde 2024 la
  reputación de SmartScreen se gana con descargas, también con EV.

La **Microsoft Store** es la única vía que quita el aviso desde el primer día: Microsoft vuelve a
firmar el paquete MSIX. El alta de particular es gratis.

## Objetivos

1. Surco se publica en la Store, **gratis**, como en la web.
2. Cada release estable llega a la Store **sin pasos a mano** después de la primera publicación.
3. La web manda a los usuarios de Windows a la Store como opción principal.
4. El `.exe` sigue existiendo y actualizándose igual que hoy.

## No objetivos

- Certificado OV para el `.exe` (se decidirá aparte).
- Paquete para Windows ARM. Hoy solo hay build x64 (`windows-latest`) y así sigue.
- Betas en la Store. Solo van las versiones estables (ver «Decisiones mías»).
- Migrar la configuración de un usuario del `.exe` a la Store. Con la redirección desactivada
  no hace falta: las dos usan `%APPDATA%\Surco`.
- **Tener el `.exe` y la Store instalados a la vez** (Vicent, 22/10, siguiendo mi recomendación).
  Compartirían ajustes y colas, y la Store va una versión por detrás mientras dura la
  certificación; una versión vieja reescribiendo los ajustes de una nueva ya hizo perder datos
  (`LOCAL_KEYS`). La web y las FAQ dicen que, para pasar a la Store, se desinstala antes el
  `.exe`, y que los datos se conservan.
- Contar las instalaciones de la Store en el contador de descargas de la web.

## Anti-objetivos

- **Que un fallo de la Store tumbe el release.** El `.exe`, el `.dmg` y el AppImage salen igual
  aunque Microsoft rechace o el envío falle.
- **Que la versión de la Store se intente actualizar sola** con `electron-updater`. Dentro de un
  paquete MSIX no puede, y enseñaría errores o un «hay versión nueva» que no lleva a ningún sitio.
- **Dejar en la web algo que ya no es verdad** (la página de SignPath).

## Lo medido antes de decidir

Prueba desechable en CI, rama `spike/store-probe`, run
https://github.com/surco-app/surco/actions/runs/39805857919 (windows-latest).

El riesgo era que MSIX redirige a una carpeta privada las escrituras en `%APPDATA%` y Surco
escribe junto al `master.db` de rekordbox (`%APPDATA%\Pioneer\rekordbox\`): copias
`.surco-backup` y `.surco-session`, un `.surco-tmp` renombrado sobre el XML de playlists y el
`-wal`/`-shm` de SQLite.

Resultado con el manifiesto **por defecto** de electron-builder: todo acaba en la carpeta real y
desde fuera se leen las filas escritas. Un control escribiendo en una carpeta **nueva** de
`%APPDATA%` sí se redirige, así que la redirección estaba activa: solo afecta a carpetas que no
existían. Traktor (`Documentos`), Engine DJ y Serato (`Música`) quedan fuera de `AppData`.

Consecuencia para rekordbox: con el manifiesto por defecto bastaría. Límite: no se probó con
rekordbox real ni en Windows 11 de escritorio.

**Pero el `userData` de Surco sí se ve afectado** (lo señaló la revisión del diseño). Quien instala
desde la Store sin haber tenido el `.exe` no tiene `%APPDATA%\Surco`, así que esa carpeta nueva se
redirigiría a la carpeta privada del paquete. Ahí viven los Originales (`userData/trash`,
`index.ts:342`), los ajustes, las colas y el log. Windows borra esa carpeta al desinstalar, con los
Originales dentro, y «Mostrar en carpeta» (`trashIpc.ts:28`) o la ruta que enseña Ajustes
apuntarían a un sitio que el Explorador no ve.

Decisión (Vicent, 22/10, siguiendo mi recomendación): **desactivar la redirección** con la
capacidad restringida `unvirtualizedResources`. La prueba ya generó y probó esa variante en CI
(`packaging/store-probe/unvirtualized.appxmanifest.xml` en la rama `spike/store-probe`). Así la
versión de la Store guarda todo donde el `.exe`.

Lo aprendido al generar el paquete en CI:

- El `signtool` de winCodeSign 2.6.0 falla en Windows Server («A required function is not
  present»). No afecta aquí: el paquete de la Store va sin firmar (lo firma Microsoft) y
  electron-builder ya lo deja sin firmar al recibir la identidad de la Store
  («AppX is not signed, reason=Windows Store only build»).

## Datos de la cuenta (Partner Center)

Cuenta de particular, nombre «Surco» reservado como app **MSIX**.

| Campo | Valor |
|---|---|
| `Package/Identity/Name` | `VicentGozalbes.Surco` |
| `Package/Identity/Publisher` | `CN=D13B979E-AC81-4811-B7E0-309749169C20` |
| `PublisherDisplayName` | `Vicent Gozalbes` |
| Store ID | `9P8C4M673334` |
| Tenant de Entra | `surcoapp.onmicrosoft.com` |
| App de Entra para el CI | `surco-ci`, rol Manager |

Secretos ya creados en `surco-app/surco`: `PARTNER_CENTER_TENANT_ID`,
`PARTNER_CENTER_CLIENT_ID`, `PARTNER_CENTER_CLIENT_SECRET`, `PARTNER_CENTER_SELLER_ID`.
**La clave de `surco-ci` caduca el 22/10/2028.**

## Qué se construye

### 1. Paquete de la Store

- Target `appx` para x64 en `apps/desktop/electron-builder.yml`, con la identidad de la tabla.
- **Manifiesto propio** (`appx.customManifestPath`) basado en la plantilla de electron-builder,
  como el de la prueba: `<desktop6:FileSystemWriteVirtualization>disabled</...>` en `Properties`,
  las capacidades `runFullTrust` y `unvirtualizedResources`, `MinVersion` 10.0.18362.0 y
  `MaxVersionTested` por encima. Hace falta `toolsets.winCodeSign: 1.1.0` (Windows Kits
  10.0.26100), porque el `makeappx` antiguo rechaza `desktop6`. Lo comprobó la prueba.
  Solo se genera en el release (y donde haga falta probarlo), no en cada build de Windows.
- Iconos propios para el paquete en `apps/desktop/build/appx/` (StoreLogo, Square44x44,
  Square150x150, Wide310x150, con las escalas que pida electron-builder), generados a partir del
  icono de Surco. Sin ellos electron-builder mete los de ejemplo de Electron.
- Idiomas del paquete: los cinco de la app (es, en, de, fr, pt-BR). Partner Center pide una
  ficha por idioma declarado, así que se preparan cinco textos de ficha.

### 2. La app sabe que viene de la Store

En el paquete de la Store (`process.windowsStore === true`):

- No se arranca `electron-updater` (bloque `if (app.isPackaged)` de
  `apps/desktop/src/main/index.ts`, hacia la línea 1722).
- «Buscar actualizaciones» del menú (`checkForUpdates`, hacia la línea 502) no comprueba nada
  y dice que las actualizaciones llegan por la Store. Texto nuevo en las traducciones del menú.
- El ajuste de «betas» no se ofrece, o se queda deshabilitado con su explicación, siguiendo la
  regla de Settings de no aparecer/desaparecer.

### 3. Envío automático en el release

En `.github/workflows/release.yml`:

- El job de Windows genera el paquete de la Store y lo sube como artefacto del run.
- El envío va en un **job aparte, después de `publish`**, que descarga ese artefacto. Así la
  Store solo recibe versiones que llegaron a ser estables en GitHub (si falla macOS o `verify`,
  no se envía nada).
- Enviarlo con la herramienta oficial `msstore` (acción de Microsoft `microsoft-store-apppublisher`):
  `msstore reconfigure` con los cuatro secretos y `msstore publish` con el Store ID.
- **Solo en versiones estables**, no en betas.
- **Si falla, el release sigue.** El paso no puede tumbar el job ni la subida del `.exe`; el fallo
  queda visible en el resumen del run.
- **Si hay un envío anterior todavía en certificación**, se borra y se sustituye por el nuevo.
  Hay días con varios estables seguidos (v1.8.0, v1.8.1 y v1.8.2 el 13/10) y Partner Center no
  admite un envío nuevo con otro pendiente; saltarse el hotfix dejaría a los usuarios de la Store
  con la versión rota.
- El artefacto del paquete sirve también para la primera publicación a mano.

### 4. Primera publicación (a mano, Vicent)

`msstore publish` solo actualiza una app que ya tiene una publicación. La primera la hace Vicent
en Partner Center con el paquete del artefacto: justificación de la capacidad restringida
`unvirtualizedResources` (Surco edita las bibliotecas de rekordbox y guarda copias de los ficheros
del usuario en `%APPDATA%`; se le prepara el texto), ficha, capturas, clasificación por edades,
política de privacidad y precio gratis. Se le preparan los textos de la ficha (es/en).

Hasta que exista esa primera publicación, el envío automático fallaría en cada release. Se
controla con una variable del repo (`STORE_PUBLISH`): el paso de envío solo corre si vale `1`, y
Vicent la activa al terminar la primera publicación.

### 5. Web

- El botón de descarga de Windows (`apps/web/src/components/DownloadButton.tsx`) lleva a la
  Store: `https://apps.microsoft.com/detail/9P8C4M673334`.
- Debajo, un enlace secundario «Descargar el instalador (.exe)» al instalador de siempre.
- El aviso de SmartScreen que ya existe (`download.smartscreen`) se muestra solo junto a ese
  enlace del `.exe`, no junto al botón de la Store.
- Se retira la página «Code signing policy» (`/code-signing`, `CodeSigning.tsx`,
  `codeSigning.test.ts`, claves `codeSigning.*`, enlace del `Footer`, `nav.ts`, `sitemap.ts` y
  `public/sitemap.xml`). Dice que SignPath firma Surco y no es verdad.
- La respuesta de las FAQ sobre SmartScreen se actualiza para nombrar la Store.
- Una respuesta en las FAQ (o una línea junto al botón) para quien ya tiene el `.exe`: desinstalarlo
  antes de instalar desde la Store; sus datos se conservan.

**La parte web va al final y no sale hasta que la ficha de la Store esté publicada**, porque
antes el enlace `apps.microsoft.com/detail/9P8C4M673334` no existe. Es un entregable aparte.

Antes de tocar la web, Vicent quiere ver un boceto dibujado (artifact) del botón con el enlace
secundario, no una lista de opciones.

### 6. Documentación

Reescribir `packaging/windows-signing.md`: la Store como vía, SignPath rechazado (y cuándo
volver a pedirlo), Azure no disponible para particulares, los datos de la cuenta, cómo renovar la
clave de `surco-ci` antes del 22/10/2028 y qué es `STORE_PUBLISH`.

## Decisiones mías (no las pidió Vicent; revisables)

- **Solo versiones estables a la Store.** La Store exige números de versión `x.y.z.0` crecientes y
  no tiene un canal de betas sencillo. Las betas siguen por el `.exe`.
- **Variable `STORE_PUBLISH`** para no fallar en cada release antes de la primera publicación.
- **Redirigir `/code-signing` a la home** en vez de dejar un 404, porque la URL pudo enlazarse
  desde la solicitud a SignPath.
- **Cinco idiomas en el paquete**, los mismos que habla la app.
- **Envío en un job posterior a `publish`**, no dentro del job de Windows.
- **Un envío pendiente se sustituye** por el nuevo en vez de saltarse el release.
- **La web espera a que la ficha esté publicada.**
- **El paquete de la Store solo en el release**, no en `build-test.yml`, salvo que haga falta para
  probar.

## Lo que queda a quien lo construya

- El orden exacto de los pasos en `release.yml` y cómo marcar «solo estables» con el tag.
- Cómo detectar `process.windowsStore` de forma testeable (seam inyectable como en el resto
  del main).
- El copy final de la web y del menú, en es/en, sin guion largo ni dos puntos de explicación.
- Generar los iconos del paquete.

## Pendiente fuera del código

- Primera publicación en Partner Center (Vicent).
- Una prueba real con rekordbox desde la versión de la Store, por parte de algún usuario de
  Windows.
- Borrar la rama `spike/store-probe` y su worktree cuando ya no hagan falta.
