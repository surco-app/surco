# Wizard relanzable desde el menú — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reabrir el wizard de onboarding desde el menú Ayuda, con re-runs que respetan el estado actual del usuario (spec: `docs/superpowers/specs/2026-07-23-wizard-desde-menu-design.md`).

**Architecture:** Toda la lógica nueva vive en `renderer/src/lib/onboarding.ts` (sembrado de intents + delta sobre `editorSections`); el wizard solo cambia su inicialización y lo que pasa a `buildOnboardingPatch`. El punto de entrada reutiliza la receta menú → `run('onboarding')` → comando del registry → `overlays.openOnboarding()` (ya existente).

**Tech Stack:** React 19 + TS, Vitest (+ Testing Library jsdom para el componente), Biome, i18n del renderer (JSON en 5 locales) e i18n del main (objetos TS en `src/main/i18n.ts`).

## Global Constraints

- Todo el trabajo en un git worktree aislado creado con `superpowers:using-git-worktrees` — nunca directo sobre main.
- Directorio de trabajo de todos los comandos: `apps/desktop`.
- Commits: título descriptivo en español, sin body y sin prefijos `feat:`/`fix:`. Un commit por funcionalidad; compila y con tests en verde.
- NUNCA `npm run check` ni `npm run format` (reformatean ~92 ficheros ajenos). Verificar por fichero: `npx biome check <fichero>` y `npx tsc --build`.
- TDD: escribir el test, verlo fallar, implementar, verlo pasar.
- Los comentarios siguen el estilo del repo: breves, explican el porqué, en inglés.
- Locales: 5 idiomas siempre (`en`, `es`, `de`, `fr`, `pt-BR`), tanto en renderer (`src/renderer/src/i18n/locales/*.json`) como en main (`src/main/i18n.ts`).

---

### Task 1: `seedAudioIntents` — sembrar los intents desde el estado actual

**Files:**
- Modify: `src/renderer/src/lib/onboarding.ts`
- Test: `src/renderer/src/lib/onboarding.test.ts`

**Interfaces:**
- Consumes: `Settings` (`src/shared/types.ts`), `EditorSectionId` (`src/shared/editorSections.ts`), constantes ya existentes en `onboarding.ts` (`INTENT_SECTIONS`).
- Produces: `export function seedAudioIntents(settings: Pick<Settings, 'hasSeenOnboarding' | 'showSpectrum' | 'editorSections'>): AudioIntent[]` — Task 2 y Task 3 la consumen con esta firma exacta.

- [ ] **Step 1: Commitear la spec (primer commit del worktree)**

```bash
git add docs/superpowers/specs/2026-07-23-wizard-desde-menu-design.md docs/superpowers/plans/2026-07-23-wizard-desde-menu.md
git commit -m "Spec y plan del wizard relanzable desde el menu"
```

- [ ] **Step 2: Escribir los tests que fallan**

En `src/renderer/src/lib/onboarding.test.ts`, añadir `seedAudioIntents` al import de `./onboarding` y este bloque al final del fichero. El objeto `settings` baseline del fichero ya tiene `hasSeenOnboarding: false`, `showSpectrum: false` y `editorSections: DEFAULT_EDITOR_SECTIONS`.

```ts
describe('seedAudioIntents', () => {
  // First run keeps the shipped behavior: intents start unpicked (except the
  // spectrum-backed one) so a brand-new editor stays minimal until the DJ opts in.
  it('seeds only the spectrum-backed intent on a first run', () => {
    expect(seedAudioIntents(settings)).toEqual([])
    expect(seedAudioIntents({ ...settings, showSpectrum: true })).toEqual(['quality'])
  })

  // A re-run must open with the checkboxes reflecting what the DJ already has,
  // so finishing without touching anything can be a no-op.
  it('seeds intents from the visible sections on a re-run', () => {
    const rerun = { ...settings, hasSeenOnboarding: true }
    expect(seedAudioIntents(rerun)).toEqual(['restore', 'level'])
    expect(seedAudioIntents({ ...rerun, showSpectrum: true })).toEqual([
      'restore',
      'level',
      'quality',
    ])
  })

  // restore owns two sections; a hand-arranged half state (only declick visible)
  // seeds it unpicked, so leaving it untouched preserves the mixed state.
  it('does not seed restore from a mixed hand-arranged state', () => {
    const sections = DEFAULT_EDITOR_SECTIONS.map((s) =>
      s.id === 'trim' ? { ...s, hidden: true } : s,
    )
    expect(
      seedAudioIntents({ ...settings, hasSeenOnboarding: true, editorSections: sections }),
    ).toEqual(['level'])
  })

  it('does not seed level when normalize is hidden', () => {
    const sections = DEFAULT_EDITOR_SECTIONS.map((s) =>
      s.id === 'normalize' ? { ...s, hidden: true } : s,
    )
    expect(
      seedAudioIntents({ ...settings, hasSeenOnboarding: true, editorSections: sections }),
    ).toEqual(['restore'])
  })
})
```

- [ ] **Step 3: Verificar que fallan**

Run: `npx vitest run src/renderer/src/lib/onboarding.test.ts`
Expected: FAIL — `seedAudioIntents` no existe (error de import/compilación).

- [ ] **Step 4: Implementar `seedAudioIntents`**

En `src/renderer/src/lib/onboarding.ts`, tras `shouldShowOnboarding` (línea ~60). Añadir `EditorSectionId` ya está importado (línea 3):

```ts
// What the intent checkboxes start as. First run: unpicked (except the spectrum-backed
// quality) so the new DJ's editor stays minimal until they opt in. Re-run: read back
// from the sections each intent governs, so finishing untouched changes nothing —
// restore owns two sections and only seeds picked when both are visible, leaving a
// hand-arranged half state alone.
export function seedAudioIntents(
  settings: Pick<Settings, 'hasSeenOnboarding' | 'showSpectrum' | 'editorSections'>,
): AudioIntent[] {
  if (!settings.hasSeenOnboarding) return settings.showSpectrum ? ['quality'] : []
  const visible = (id: EditorSectionId): boolean =>
    settings.editorSections.find((s) => s.id === id)?.hidden !== true
  const intents: AudioIntent[] = []
  if (visible('trim') && visible('declick')) intents.push('restore')
  if (visible('normalize')) intents.push('level')
  if (settings.showSpectrum) intents.push('quality')
  return intents
}
```

- [ ] **Step 5: Verificar que pasan**

Run: `npx vitest run src/renderer/src/lib/onboarding.test.ts`
Expected: PASS (los existentes y los 4 nuevos).

- [ ] **Step 6: Verificación por fichero y commit**

```bash
npx tsc --build
npx biome check src/renderer/src/lib/onboarding.ts src/renderer/src/lib/onboarding.test.ts
git add src/renderer/src/lib/onboarding.ts src/renderer/src/lib/onboarding.test.ts
git commit -m "Sembrar los audio intents del wizard desde el estado actual"
```

---

### Task 2: Delta en `buildOnboardingPatch` + wiring del wizard

**Files:**
- Modify: `src/renderer/src/lib/onboarding.ts`
- Modify: `src/renderer/src/components/OnboardingWizard.tsx:44-63`
- Test: `src/renderer/src/lib/onboarding.test.ts`
- Test: `src/renderer/src/components/OnboardingWizard.test.tsx`

**Interfaces:**
- Consumes: `seedAudioIntents` (Task 1), `buildSettingsPatch`/`deriveEditorSections` (existentes).
- Produces: `OnboardingDrafts` pasa a ser `{ synced: SyncedDraft; local: LocalDraft; audioIntents: AudioIntent[]; seededIntents: AudioIntent[]; settings: Pick<Settings, 'hasSeenOnboarding' | 'editorSections'> }`. La firma pública `buildOnboardingPatch(drafts: OnboardingDrafts | null): Partial<Settings>` no cambia.

Nota: el cambio de interface rompe la llamada del wizard, así que lógica y wiring van en el mismo commit para que cada commit compile.

- [ ] **Step 1: Actualizar el helper `drafts()` del test**

En `src/renderer/src/lib/onboarding.test.ts` (líneas 77-89), sustituir el helper por:

```ts
function drafts(
  over: {
    synced?: Partial<SyncedDraft>
    local?: Partial<LocalDraft>
    audioIntents?: AudioIntent[]
    seededIntents?: AudioIntent[]
    settings?: Pick<Settings, 'hasSeenOnboarding' | 'editorSections'>
  } = {},
): NonNullable<Parameters<typeof buildOnboardingPatch>[0]> {
  return {
    synced: { ...pickSynced(settings), ...over.synced },
    local: { ...pickLocal(settings), ...over.local },
    audioIntents: over.audioIntents ?? [],
    seededIntents: over.seededIntents ?? [],
    settings: over.settings ?? {
      hasSeenOnboarding: false,
      editorSections: DEFAULT_EDITOR_SECTIONS,
    },
  }
}
```

Los defaults (`hasSeenOnboarding: false`) dejan todos los tests existentes en la rama de primer run, sin tocarlos.

- [ ] **Step 2: Escribir los tests del re-run que fallan**

Añadir al final de `onboarding.test.ts`:

```ts
describe('buildOnboardingPatch on a re-run', () => {
  // A layout the DJ arranged by hand: reordered, refolded, otherTags and the
  // vinyl-repair pair hidden. The re-run must treat it as sacred.
  const customized = [
    { id: 'form', open: true },
    { id: 'otherTags', open: true, hidden: true },
    { id: 'quality', open: false },
    { id: 'properties', open: true },
    { id: 'normalize', open: true },
    { id: 'trim', open: false, hidden: true },
    { id: 'declick', open: false, hidden: true },
    { id: 'output', open: false },
  ] satisfies Settings['editorSections']
  const rerun = { hasSeenOnboarding: true, editorSections: customized }

  // The core promise of the menu entry: reopen, press Finish, nothing changes.
  it('leaves the section layout untouched when no intent was toggled', () => {
    const patch = buildOnboardingPatch(
      drafts({ audioIntents: ['level'], seededIntents: ['level'], settings: rerun }),
    )
    expect(patch.editorSections).toEqual(customized)
  })

  // Toggling one intent on reveals exactly its sections — order, folds and the
  // sections no intent governs (otherTags) survive byte for byte.
  it('reveals only the toggled-on intent sections, preserving everything else', () => {
    const patch = buildOnboardingPatch(
      drafts({ audioIntents: ['level', 'restore'], seededIntents: ['level'], settings: rerun }),
    )
    expect(patch.editorSections).toEqual([
      { id: 'form', open: true },
      { id: 'otherTags', open: true, hidden: true },
      { id: 'quality', open: false },
      { id: 'properties', open: true },
      { id: 'normalize', open: true },
      { id: 'trim', open: false },
      { id: 'declick', open: false },
      { id: 'output', open: false },
    ])
  })

  // Toggling one intent off hides its sections and nothing else: trim/declick keep
  // the hidden they already had, untouched by the unchanged restore intent.
  it('hides only the toggled-off intent sections', () => {
    const patch = buildOnboardingPatch(
      drafts({ audioIntents: [], seededIntents: ['level'], settings: rerun }),
    )
    expect(patch.editorSections).toEqual([
      { id: 'form', open: true },
      { id: 'otherTags', open: true, hidden: true },
      { id: 'quality', open: false },
      { id: 'properties', open: true },
      { id: 'normalize', open: true, hidden: true },
      { id: 'trim', open: false, hidden: true },
      { id: 'declick', open: false, hidden: true },
      { id: 'output', open: false },
    ])
  })

  // First run still rebuilds from the defaults (hiding otherTags): the shipped
  // new-user behavior must not change because re-runs exist.
  it('keeps deriving from defaults on a first run', () => {
    const patch = buildOnboardingPatch(drafts({ audioIntents: ['restore'] }))
    expect(patch.editorSections).toEqual(deriveEditorSections(['restore']))
  })
})
```

- [ ] **Step 3: Verificar que fallan**

Run: `npx vitest run src/renderer/src/lib/onboarding.test.ts`
Expected: FAIL — los objetos con `seededIntents`/`settings` no compilan contra la interface actual (o los asserts del delta fallan).

- [ ] **Step 4: Implementar el delta en `onboarding.ts`**

Sustituir `OnboardingDrafts` y `buildOnboardingPatch` (líneas 48-76) por:

```ts
// The wizard stages its edits in the same drafts the Settings modal uses, plus the
// audio-intent question that only exists here. seededIntents and the settings the
// wizard opened with make a re-run diffable: only what the DJ toggled is applied.
interface OnboardingDrafts {
  synced: SyncedDraft
  local: LocalDraft
  // What the DJ does with the audio, which decides the editor's visible sections and
  // whether the spectrogram is on.
  audioIntents: AudioIntent[]
  seededIntents: AudioIntent[]
  settings: Pick<Settings, 'hasSeenOnboarding' | 'editorSections'>
}

// A re-run edits the DJ's own layout instead of rebuilding it: only the intents that
// changed against their seeded value touch the hidden flag of the sections they
// govern. Order, folds and ungoverned sections (otherTags) pass through untouched, so
// finishing an untouched wizard is a no-op.
function applyIntentDelta(
  current: EditorSectionPref[],
  seeded: AudioIntent[],
  picked: AudioIntent[],
): EditorSectionPref[] {
  const hideBySection = new Map<EditorSectionId, boolean>()
  for (const intent of Object.keys(INTENT_SECTIONS) as AudioIntent[]) {
    if (seeded.includes(intent) === picked.includes(intent)) continue
    for (const id of INTENT_SECTIONS[intent]) hideBySection.set(id, !picked.includes(intent))
  }
  return current.map((section) => {
    const hide = hideBySection.get(section.id)
    if (hide === undefined) return section
    // hidden is only ever present as true (normalizeEditorSections' shape) — reveal
    // by dropping the key, not by writing hidden: false.
    return { id: section.id, open: section.open, ...(hide ? { hidden: true } : {}) }
  })
}

export function shouldShowOnboarding(settings: Pick<Settings, 'hasSeenOnboarding'>): boolean {
  return !settings.hasSeenOnboarding
}

// Passing null means the user skipped: we only flag the wizard as seen so it
// never reappears, leaving the existing settings untouched.
export function buildOnboardingPatch(drafts: OnboardingDrafts | null): Partial<Settings> {
  if (!drafts) return { hasSeenOnboarding: true }
  return {
    // The shared serialization — trim/clamp/gating rules included — so a field (or a
    // rule) added to the Settings save path can never miss the wizard's.
    ...buildSettingsPatch(drafts.synced, drafts.local),
    // The spectrogram is the payload of the "check quality" intent; without it a
    // metadata-only DJ isn't paying for the analysis pass.
    showSpectrum: drafts.audioIntents.includes('quality'),
    // First run builds the layout from the defaults (the shipped new-user behavior,
    // otherTags included); a re-run applies only what the DJ toggled onto their own.
    editorSections: drafts.settings.hasSeenOnboarding
      ? applyIntentDelta(drafts.settings.editorSections, drafts.seededIntents, drafts.audioIntents)
      : deriveEditorSections(drafts.audioIntents),
    hasSeenOnboarding: true,
  }
}
```

(`shouldShowOnboarding` se conserva idéntico; se muestra por contexto de la sustitución. `EditorSectionPref` ya está importado en la línea 4.)

- [ ] **Step 5: Wiring del wizard**

En `src/renderer/src/components/OnboardingWizard.tsx`:

Añadir `seedAudioIntents` al import de `../lib/onboarding` (línea 7):

```ts
import { type AudioIntent, buildOnboardingPatch, seedAudioIntents } from '../lib/onboarding'
```

Sustituir el sembrado (líneas 44-48):

```ts
  // Seeded once from the settings the wizard opened with; kept so finish can diff
  // what the DJ actually toggled (a re-run only applies those changes).
  const [seededIntents] = useState<AudioIntent[]>(() => seedAudioIntents(settings))
  const [audioIntents, setAudioIntents] = useState<AudioIntent[]>(seededIntents)
```

Sustituir `finish` (líneas 61-63):

```ts
  function finish(): void {
    onFinish(buildOnboardingPatch({ synced, local, audioIntents, seededIntents, settings }))
  }
```

- [ ] **Step 6: Test de componente del sembrado en re-run**

En `src/renderer/src/components/OnboardingWizard.test.tsx`, añadir (el fixture `settings` del fichero tiene `showSpectrum: true` y `hasSeenOnboarding: false`; reutilizar el helper de navegación del fichero si existe, si no, el bucle de clicks):

```tsx
  // A re-run opens with the checkboxes reading the DJ's current editor, so Finish
  // without touching anything cannot change the layout.
  it('seeds the audio intents from the current editor on a re-run', () => {
    const rerun: Settings = {
      ...settings,
      hasSeenOnboarding: true,
      showSpectrum: false,
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'trim' || s.id === 'declick' ? { ...s, hidden: true } : s,
      ),
    }
    render(<OnboardingWizard settings={rerun} onFinish={vi.fn()} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('onboarding-intent-restore')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-intent-level')).toBeChecked()
    expect(screen.getByTestId('onboarding-intent-quality')).not.toBeChecked()
  })

  it('finishing an untouched re-run leaves the editor layout as it was', () => {
    const onFinish = vi.fn()
    const rerun: Settings = { ...settings, hasSeenOnboarding: true }
    render(<OnboardingWizard settings={rerun} onFinish={onFinish} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onFinish.mock.calls[0][0].editorSections).toEqual(rerun.editorSections)
  })
```

- [ ] **Step 7: Verificar que todo pasa**

Run: `npx vitest run src/renderer/src/lib/onboarding.test.ts src/renderer/src/components/OnboardingWizard.test.tsx`
Expected: PASS — incluidos todos los tests preexistentes de ambos ficheros.

- [ ] **Step 8: Verificación por fichero y commit**

```bash
npx tsc --build
npx biome check src/renderer/src/lib/onboarding.ts src/renderer/src/lib/onboarding.test.ts src/renderer/src/components/OnboardingWizard.tsx src/renderer/src/components/OnboardingWizard.test.tsx
git add src/renderer/src/lib/onboarding.ts src/renderer/src/lib/onboarding.test.ts src/renderer/src/components/OnboardingWizard.tsx src/renderer/src/components/OnboardingWizard.test.tsx
git commit -m "Aplicar los intents del wizard como delta sobre el layout del editor en re-runs"
```

---

### Task 3: Comando `onboarding` en el registry y la paleta

**Files:**
- Modify: `src/renderer/src/lib/commands.ts` (interface `CommandDeps` ~línea 211-217, destructuring ~247-299, lista de comandos tras `'help'` ~línea 760)
- Modify: `src/renderer/src/App.tsx:1330-1398` (deps de `buildCommands`)
- Modify: `src/renderer/src/i18n/locales/{en,es,de,fr,pt-BR}.json` (objeto `commands`)
- Test: `src/renderer/src/lib/commands.test.ts`

**Interfaces:**
- Consumes: `overlays.openOnboarding: () => void` (ya existe en `useOverlays.ts:36`).
- Produces: comando con `id: 'onboarding'`, `group: 'app'`, `title: tr('commands.onboarding')` — Task 4 lo dispara desde el menú con `run('onboarding')`.

- [ ] **Step 1: Escribir el test que falla**

En `src/renderer/src/lib/commands.test.ts`, añadir `openOnboarding: () => {}` al fixture `makeDeps` (junto a `openHelp`, línea ~87) y este test junto a los de `buildCommands`:

```ts
  // The menu's Help → Setup assistant re-opens the wizard through the same registry
  // the palette uses, so both entry points can never drift.
  it('opens the onboarding wizard from the onboarding command', () => {
    const openOnboarding = vi.fn()
    runCommand(buildCommands(makeDeps({ openOnboarding })), 'onboarding')
    expect(openOnboarding).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/renderer/src/lib/commands.test.ts`
Expected: FAIL — `openOnboarding` no existe en `CommandDeps` (error de compilación).

- [ ] **Step 3: Implementar**

En `src/renderer/src/lib/commands.ts`:

1. En `CommandDeps`, junto a `openHelp` (línea ~216):

```ts
  openHelp: () => void
  openOnboarding: () => void
```

2. En el destructuring de `buildCommands`, junto a `openHelp`:

```ts
    openHelp,
    openOnboarding,
```

3. En la lista de comandos, inmediatamente después del comando `'help'` (línea ~760):

```ts
    {
      id: 'onboarding',
      group: 'app',
      title: tr('commands.onboarding'),
      enabled: true,
      run: openOnboarding,
    },
```

En `src/renderer/src/App.tsx`, en el objeto de deps de `buildCommands` (junto a `openHelp: overlays.openHelp`, línea ~1390):

```ts
      openHelp: overlays.openHelp,
      openOnboarding: overlays.openOnboarding,
```

- [ ] **Step 4: Añadir la clave `commands.onboarding` a los 5 locales**

Dentro del objeto `"commands"`, junto a `"guide"`:

- `en.json`: `"onboarding": "Setup assistant"`
- `es.json`: `"onboarding": "Asistente de configuración"`
- `de.json`: `"onboarding": "Einrichtungsassistent"`
- `fr.json`: `"onboarding": "Assistant de configuration"`
- `pt-BR.json`: `"onboarding": "Assistente de configuração"`

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/renderer/src/lib/commands.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificación por fichero y commit**

```bash
npx tsc --build
npx biome check src/renderer/src/lib/commands.ts src/renderer/src/lib/commands.test.ts src/renderer/src/App.tsx
git add src/renderer/src/lib/commands.ts src/renderer/src/lib/commands.test.ts src/renderer/src/App.tsx src/renderer/src/i18n/locales/en.json src/renderer/src/i18n/locales/es.json src/renderer/src/i18n/locales/de.json src/renderer/src/i18n/locales/fr.json src/renderer/src/i18n/locales/pt-BR.json
git commit -m "Anadir el comando onboarding al registry y la paleta"
```

---

### Task 4: Entrada en el menú Ayuda (main process)

**Files:**
- Modify: `src/main/i18n.ts` (interface `MenuStrings` línea ~9-52 y los 5 bloques de idioma)
- Modify: `src/main/index.ts:348-360` (submenú Help de `buildAppMenu`)

**Interfaces:**
- Consumes: `run('onboarding')` → comando de Task 3; `t = createMenuT(...)` existente.
- Produces: item de menú Ayuda con clave i18n `setupAssistant`.

No existe harness de tests para `buildAppMenu`; la cobertura es el test de Task 3 (el comando) más el tipado de `Record<MenuLang, MenuStrings>`, que obliga a los 5 idiomas en compilación.

- [ ] **Step 1: Añadir la clave `setupAssistant` al i18n del main**

En `src/main/i18n.ts`, añadir `setupAssistant: string` a la interface `MenuStrings` (junto a `guide`, línea ~31) y la traducción en cada bloque de idioma, junto a `guide` (con ellipsis, como `settings`/`feedback` — abre un diálogo):

- `es` (línea ~76): `setupAssistant: 'Asistente de configuración…',`
- `en` (línea ~119): `setupAssistant: 'Setup assistant…',`
- `de` (línea ~162): `setupAssistant: 'Einrichtungsassistent…',`
- `fr` (línea ~205): `setupAssistant: 'Assistant de configuration…',`
- `pt-BR` (línea ~248): `setupAssistant: 'Assistente de configuração…',`

- [ ] **Step 2: Añadir el item al submenú Help**

En `src/main/index.ts` (líneas 348-360), tras el item `guide`:

```ts
      submenu: [
        { label: t('faq'), click: () => run('help') },
        { label: t('guide'), click: () => run('guide') },
        { label: t('setupAssistant'), click: () => run('onboarding') },
        { type: 'separator' },
        { label: t('website'), click: () => run('website') },
        { label: t('feedback'), click: () => run('feedback') },
      ],
```

- [ ] **Step 3: Verificar compilación y tests del main**

```bash
npx tsc --build
npx vitest run src/main/i18n.test.ts src/main/menuCommand.test.ts
```
Expected: compila (el tipado obliga a los 5 idiomas) y PASS.

- [ ] **Step 4: Verificación por fichero y commit**

```bash
npx biome check src/main/i18n.ts src/main/index.ts
git add src/main/i18n.ts src/main/index.ts
git commit -m "Anadir el asistente de configuracion al menu Ayuda"
```

---

### Task 5: Verificación final

- [ ] **Step 1: Suite completa del workspace**

Run (desde `apps/desktop`): `npm test`
Expected: PASS, cero tests saltados. Si algún test ajeno falla, parar y reportar — no tocar tests no relacionados.

- [ ] **Step 2: Typecheck y lint de los ficheros tocados**

```bash
npx tsc --build
npx biome check src/renderer/src/lib/onboarding.ts src/renderer/src/lib/commands.ts src/renderer/src/components/OnboardingWizard.tsx src/renderer/src/App.tsx src/main/i18n.ts src/main/index.ts
```
Expected: sin errores ni warnings.

- [ ] **Step 3: Verificación manual (opcional)**

Con la skill `run-desktop`: arrancar la app, menú Ayuda → "Asistente de configuración…", comprobar que el wizard abre con los valores actuales y que Terminar sin tocar nada no cambia Settings → Editor. Nota: el smoke de run-desktop está roto en main desde 2026-07-23; si bloquea, saltar este paso y decirlo.
