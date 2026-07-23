# Wizard de bienvenida relanzable desde el menú

## Problema

El wizard de onboarding solo lo ven los usuarios nuevos: se abre una única vez cuando
`hasSeenOnboarding` es false (`renderer/src/hooks/useLaunchModals.ts:30`) y no existe
ningún punto de entrada para volver a abrirlo. Un usuario existente que quiera repasar
su configuración con el flujo guiado no puede.

Desde la migración a drafts (`92c31307`) el wizard ya siembra sus pasos de búsqueda y
formato desde los settings *actuales* (`pickSynced`/`pickLocal`,
`renderer/src/components/OnboardingWizard.tsx:42-43`), así que reabrirlo mostraría los
valores reales del usuario. El obstáculo es el paso de audio: los intents no se siembran
desde el estado actual (salvo `quality` desde `showSpectrum`) y al terminar
`deriveEditorSections` regenera toda la lista de secciones desde
`DEFAULT_EDITOR_SECTIONS` (`renderer/src/lib/onboarding.ts:37-46`), machacando
visibilidad, orden y plegado que el usuario haya personalizado en Settings → Editor.

## Qué se construye

**Reconfiguración guiada que respeta el estado existente**: una entrada en el menú
**Ayuda** que reabre el wizard, y los cambios en el paso de audio para que un re-run
sea fiel al estado actual. Reabrir el wizard y pulsar Terminar sin tocar nada es un
no-op (salvo `hasSeenOnboarding: true`, ya inocuo).

### 1. Sembrar los intents desde el estado actual

Nueva función `seedAudioIntents(settings)` en `renderer/src/lib/onboarding.ts`:

- `restore` — marcado si `trim` **y** `declick` están visibles (no `hidden`) en
  `settings.editorSections`.
- `level` — marcado si `normalize` está visible.
- `quality` — marcado si `settings.showSpectrum` (hoy inline en
  `OnboardingWizard.tsx:46-48`; se mueve a esta función).

`OnboardingWizard` inicializa `audioIntents` con ella.

### 2. Aplicar como delta, no recalcular

En re-runs, al terminar solo los intents que el usuario **cambió** respecto al sembrado
tocan sus secciones: el intent togglado pone/quita el flag `hidden` de las secciones que
gobierna (`restore` → `trim`+`declick`, `level` → `normalize`) sobre la lista
`editorSections` actual del usuario. Todo lo demás — orden, `open`, y las secciones que
ningún intent gobierna (`otherTags`) — queda intacto.

El cálculo del delta vive en `buildOnboardingPatch`: recibe los intents finales, los
intents sembrados y los `editorSections` actuales, y construye el resultado — así toda
la lógica queda en `onboarding.ts`, testeable sin montar el componente. `showSpectrum`
sigue saliendo del intent `quality` (sembrado desde el valor actual, así que sin toggle
no cambia).

### 3. Primera ejecución: comportamiento idéntico al actual

En el primer run (cuando `hasSeenOnboarding` es false al abrir), se mantiene la
derivación actual desde `DEFAULT_EDITOR_SECTIONS`, que además oculta `otherTags` —
comportamiento deliberado para el usuario nuevo que no se quiere cambiar. Es una rama
pequeña dentro de la construcción del patch, no dos sistemas paralelos.

### 4. Punto de entrada

La receta existente menú → comando → overlay (la misma de Settings y Help):

- Item en el menú **Ayuda** (`main/index.ts`, plantilla de `buildAppMenu`), junto a
  FAQ/Guía: "Asistente de configuración…" / "Setup Assistant…" →
  `run('onboarding')`.
- Comando `onboarding` en el registry (`renderer/src/lib/commands.ts`) →
  `overlays.openOnboarding()` (ya existe, `renderer/src/hooks/useOverlays.ts:65`).
  Aparece gratis en la paleta ⌘K.
- Cadenas i18n del label en todos los locales.

## Qué NO cambia (YAGNI)

- El copy del paso de bienvenida y el botón "Omitir" son iguales en re-runs. "Omitir"
  ya actúa como cancelar sin efectos: `buildOnboardingPatch(null)` solo escribe
  `hasSeenOnboarding: true`.
- La decisión de auto-apertura en el primer arranque (`useLaunchModals.decideOnLoad`)
  no se toca.
- No se añade UI en Settings para resetear `hasSeenOnboarding`.

## Casos borde

- **Estado mixto** (p.ej. `declick` visible pero `trim` oculto a mano): `restore` se
  siembra desmarcado (exige ambas visibles). Si el usuario no lo toca, sus secciones no
  se tocan — el estado mixto sobrevive. Solo togglarlo normaliza ambas.
- **Skip en re-run**: sin efectos, como hoy.
- **Re-run con settings por defecto**: delta sin cambios = mismos settings.

## Tests

En el spec de `onboarding.ts` (TDD, rojo primero):

- `seedAudioIntents`: cada intent se siembra según visibilidad/`showSpectrum`; estado
  mixto siembra `restore` desmarcado.
- Delta: terminar sin tocar intents preserva `editorSections` byte a byte (orden,
  `open`, `otherTags`, estados mixtos).
- Delta: togglar un intent solo cambia el `hidden` de sus secciones.
- Primer run: resultado idéntico al `deriveEditorSections` actual (incluye `otherTags`
  oculto).
- Comando `onboarding` registrado y abre el overlay (patrón de los tests de comandos
  existentes).
