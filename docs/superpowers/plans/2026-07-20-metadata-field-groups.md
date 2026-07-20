# Metadata Field Groups (collapsible) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the metadata form group its fields under one collapsible section per category (Identity / Catalog / DJ / Order), each shown once, so the worst case (all 22 fields on) reads as four tidy groups instead of a tall column with headers repeated 3–4×.

**Architecture:** A pure lib function (`groupFields`) splits the flat `FieldSpec[]` into the four fixed groups in fixed order (identity → catalog → dj → order), keeping each field's relative order within its group; uncatalogued keys fall into a trailing "other" bucket so nothing is ever dropped. `MetadataForm` renders one collapsible group per non-empty bucket: Identity open by default, the rest collapsed, each header showing a "N con datos" count of fields with a non-empty value. Fold state is local component state (does not persist), keyed so it resets per track.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + Testing Library, lucide-react (ChevronRight icon), react-i18next.

## Global Constraints

- No new dependencies.
- Match existing Surco tokens/classes (`text-fg-dim`, `bg-[var(--color-field)]`, `SECTION_SUBHEAD`, `press`).
- ZERO code comments only where the repo already omits them — this file is heavily commented; match its density.
- Field order WITHIN a group is preserved; order BETWEEN groups is fixed (identity→catalog→dj→order→other). Losing cross-group manual order is intended and already agreed.
- `compilation` stays a checkbox; it lives in the `order` group.
- Tests: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run <path>`. Typecheck: `cd apps/desktop && npx tsc --build`. Lint: `npx biome check --write <files>`.

---

### Task 1: `groupFields` lib function

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/fields.ts`
- Test: `apps/desktop/src/renderer/src/lib/fields.test.ts` (create if absent)

**Interfaces:**
- Consumes: existing `FIELD_GROUPS`, `groupOfField`, `FieldGroupId` from the same file.
- Produces:
  ```ts
  export interface FieldGroupBucket<T> { id: FieldGroupId | 'other'; items: T[] }
  export function groupFields<T extends { key: string }>(fields: T[]): FieldGroupBucket<T>[]
  ```
  Returns buckets in fixed order `['identity','catalog','dj','order']` then `'other'`, each containing the input items whose `groupOfField(key)` matches (relative input order preserved), OMITTING any bucket with zero items.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/renderer/src/lib/fields.test.ts
import { describe, expect, it } from 'vitest'
import { groupFields } from './fields'

describe('groupFields', () => {
  it('splits into fixed group order, dropping empty buckets, preserving intra-group order', () => {
    const input = [
      { key: 'comment' },      // order
      { key: 'title' },        // identity
      { key: 'catalogNumber' },// catalog
      { key: 'artist' },       // identity
      { key: 'trackNumber' },  // order
    ]
    const out = groupFields(input)
    expect(out.map((b) => b.id)).toEqual(['identity', 'catalog', 'order'])
    expect(out[0].items.map((i) => i.key)).toEqual(['title', 'artist'])
    expect(out[2].items.map((i) => i.key)).toEqual(['comment', 'trackNumber'])
  })

  it('puts uncatalogued keys in a trailing other bucket', () => {
    const out = groupFields([{ key: 'title' }, { key: 'futureTag' }])
    expect(out.map((b) => b.id)).toEqual(['identity', 'other'])
    expect(out[1].items.map((i) => i.key)).toEqual(['futureTag'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/lib/fields.test.ts`
Expected: FAIL — `groupFields is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/desktop/src/renderer/src/lib/fields.ts`:

```ts
// The fixed group render order for the collapsible metadata form: the four defined groups,
// then a trailing bucket for any key not in FIELD_GROUPS (a future/unknown tag) so a field
// can never be dropped. Empty buckets are omitted so a group with no shown fields draws no
// header.
const GROUP_ORDER: FieldGroupId[] = ['identity', 'catalog', 'dj', 'order']

export interface FieldGroupBucket<T> {
  id: FieldGroupId | 'other'
  items: T[]
}

export function groupFields<T extends { key: string }>(fields: T[]): FieldGroupBucket<T>[] {
  const of = (key: string): FieldGroupId | 'other' => groupOfField(key) ?? 'other'
  const order: (FieldGroupId | 'other')[] = [...GROUP_ORDER, 'other']
  return order
    .map((id) => ({ id, items: fields.filter((f) => of(f.key) === id) }))
    .filter((b) => b.items.length > 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/lib/fields.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
cd apps/desktop && npx tsc --build && npx biome check --write src/renderer/src/lib/fields.ts src/renderer/src/lib/fields.test.ts
git add apps/desktop/src/renderer/src/lib/fields.ts apps/desktop/src/renderer/src/lib/fields.test.ts
git commit -m "Añadir groupFields para agrupar los campos de metadatos por categoría"
```

---

### Task 2: i18n key for the per-group count

**Files:**
- Modify: all five locales `apps/desktop/src/renderer/src/i18n/locales/{en,es,de,fr,pt-BR}.json`
- Test: locale parity is covered by the existing i18n test — no new test.

**Interfaces:**
- Produces: key `fields.groupFilled_one` / `fields.groupFilled_other` with `{{count}}`, under the existing `fields` object (same object that holds `title`, `artist`, group labels live under `fieldGroups`).

- [ ] **Step 1: Add the key to en.json**

In `apps/desktop/src/renderer/src/i18n/locales/en.json`, inside the `"fields"` object (near `"rating"`), add:

```json
    "groupFilled_one": "{{count}} filled",
    "groupFilled_other": "{{count}} filled",
```

- [ ] **Step 2: Add to es.json**

```json
    "groupFilled_one": "{{count}} con datos",
    "groupFilled_other": "{{count}} con datos",
```

- [ ] **Step 3: Add to de.json**

```json
    "groupFilled_one": "{{count}} ausgefüllt",
    "groupFilled_other": "{{count}} ausgefüllt",
```

- [ ] **Step 4: Add to fr.json**

```json
    "groupFilled_one": "{{count}} rempli",
    "groupFilled_other": "{{count}} remplis",
```

- [ ] **Step 5: Add to pt-BR.json**

```json
    "groupFilled_one": "{{count}} preenchido",
    "groupFilled_other": "{{count}} preenchidos",
```

- [ ] **Step 6: Run locale parity test + commit**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run -t "locale"`
Expected: PASS.

```bash
git add apps/desktop/src/renderer/src/i18n/locales/*.json
git commit -m "Añadir la cadena del contador de campos por grupo en los cinco idiomas"
```

---

### Task 3: Render collapsible groups in MetadataForm

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/MetadataForm.tsx`
- Test: `apps/desktop/src/renderer/src/components/MetadataForm.test.tsx` (create)

**Interfaces:**
- Consumes: `groupFields`, `FieldGroupBucket` from `../lib/fields` (Task 1); `fields.groupFilled` (Task 2).
- Produces: DOM testids `field-group-{id}` on each group's header button (replacing the old `<h3 data-testid="field-group-*">`), `field-group-count-{id}` on the count, and `field-group-body-{id}` on the fields wrapper (present only when open).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/desktop/src/renderer/src/components/MetadataForm.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FieldSpec } from '../lib/fieldSpecs'
import { MetadataForm } from './MetadataForm'
import type { TrackItem } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => (o?.count != null ? `${o.count} filled` : k) }),
}))

const spec = (key: string, value = ''): FieldSpec =>
  ({ key, label: key, value, placeholder: '', onChange: vi.fn() }) as unknown as FieldSpec

const item = { meta: {}, } as unknown as TrackItem

function renderForm(fields: FieldSpec[]) {
  return render(
    <MetadataForm
      item={item}
      isMulti={false}
      selectedTracks={undefined}
      release={null}
      coverDims={null}
      setCoverDims={vi.fn()}
      onChange={vi.fn()}
      onRate={vi.fn()}
      fields={fields}
    />,
  )
}

describe('MetadataForm groups', () => {
  it('shows each group once and starts with only identity open', () => {
    renderForm([spec('title', 'X'), spec('catalogNumber', 'C'), spec('bpm')])
    // identity open → its field visible
    expect(screen.getByTestId('field-group-body-identity')).toBeInTheDocument()
    // catalog present as a header but collapsed → no body
    expect(screen.getByTestId('field-group-catalog')).toBeInTheDocument()
    expect(screen.queryByTestId('field-group-body-catalog')).toBeNull()
  })

  it('toggles a collapsed group open on header click', () => {
    renderForm([spec('title', 'X'), spec('catalogNumber', 'C')])
    fireEvent.click(screen.getByTestId('field-group-catalog'))
    expect(screen.getByTestId('field-group-body-catalog')).toBeInTheDocument()
  })

  it('counts fields with a non-empty value', () => {
    renderForm([spec('title', 'X'), spec('catalogNumber', 'C'), spec('isrc', '')])
    expect(screen.getByTestId('field-group-count-catalog')).toHaveTextContent('1 filled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/MetadataForm.test.tsx`
Expected: FAIL — `field-group-body-identity` not found (old form has no such testid).

- [ ] **Step 3: Implement the grouped, collapsible render**

Replace the field-grid block in `MetadataForm.tsx`. Full new file content for the render section — the `<div className="grid …">{fields.map(...)}</div>` becomes a per-group render. Add `useState`, `ChevronRight`, `groupFields` imports; drop the `groupHeaderBefore`/`Fragment`/`SECTION_SUBHEAD` imports if now unused (keep `SECTION_SUBHEAD` — used on the group header).

Import changes at top:
```tsx
import { ChevronRight } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { buildFieldSpecs, type FieldSpec } from '../lib/fieldSpecs'
import { type FieldGroupBucket, groupFields } from '../lib/fields'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'
import { Field } from './Field'
import { SECTION_SUBHEAD } from './SectionSubhead'
import { StarRating } from './StarRating'
```

Extract the single-field renderer (so the map body isn't duplicated) as a local function ABOVE the component:
```tsx
// One field: the compilation checkbox writes the exact '1' the TCMP/COMPILATION tag needs;
// every other field is a text Field. Pulled out so both the grid map and future callers
// render a field the same way.
function renderField(f: FieldSpec): React.JSX.Element {
  if (f.key === 'compilation') {
    return (
      <label key={f.key} className="flex items-center gap-2 self-end pb-2">
        <input
          type="checkbox"
          data-testid="field-compilation"
          checked={f.value === '1'}
          onChange={(e) => f.onChange(e.target.checked ? '1' : '')}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="text-xs font-medium text-fg-dim">{f.label}</span>
      </label>
    )
  }
  return (
    <Field
      key={f.key}
      name={f.key}
      label={f.label}
      value={f.value}
      placeholder={f.placeholder}
      onChange={f.onChange}
      insertSources={f.insertSources}
      cleanResult={f.cleanResult}
      formatResult={f.formatResult}
      wide={f.wide}
      invalid={f.invalid}
      suggestions={f.suggestions}
      multiSuggestions={f.multiSuggestions}
      suggesting={f.suggesting}
    />
  )
}
```

Inside the component, replace the field `<div className="grid …">…</div>` with:
```tsx
        <div className="min-w-0 flex-1">
          {groupFields(fields).map((group, gi) => (
            <FieldGroup key={group.id} group={group} defaultOpen={gi === 0} />
          ))}
        </div>
```

Add the `FieldGroup` component below `renderField` (keeps its own open state, resets per group id because MetadataForm is keyed per track by the editor):
```tsx
// One collapsible category. Identity opens by default (defaultOpen), the rest start closed —
// a track's other tags are usually reviewed, not edited, so they stay one click away and the
// panel stays short. The header shows how many of the group's fields carry a value, so the
// user knows whether opening it is worth it without opening it.
function FieldGroup({
  group,
  defaultOpen,
}: {
  group: FieldGroupBucket<FieldSpec>
  defaultOpen: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const filled = group.items.filter((f) => f.value.trim() !== '').length
  const label = group.id === 'other' ? tr('fieldGroups.other') : tr(`fieldGroups.${group.id}`)
  return (
    <div className="border-t border-[var(--color-line)] first:border-t-0">
      <button
        type="button"
        data-testid={`field-group-${group.id}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="press flex w-full items-center gap-1.5 py-2.5 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-fg-dim transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className={SECTION_SUBHEAD}>{label}</span>
        {filled > 0 && (
          <span
            data-testid={`field-group-count-${group.id}`}
            className="ml-auto text-[10px] font-normal tracking-normal text-fg-faint tabular-nums"
          >
            {tr('fields.groupFilled', { count: filled })}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid={`field-group-body-${group.id}`}
          className="grid grid-cols-1 gap-x-4 gap-y-3 pb-3 @[26rem]:grid-cols-2"
        >
          {group.items.map((f) => (
            <div key={f.key} className={f.wide || f.key === 'compilation' ? '@[26rem]:col-span-2' : ''}>
              {renderField(f)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Note: the old code let `Field` itself span via a `wide` prop inside the grid; here the wrapping `<div>` carries the `col-span-2`, so `wide` fields and the compilation checkbox still take the full row.

- [ ] **Step 4: Add the `other` group label to all five locales**

The `other` bucket needs a label. In each `apps/desktop/src/renderer/src/i18n/locales/*.json`, inside `"fieldGroups"`, add:
- en: `"other": "Other"`
- es: `"other": "Otros"`
- de: `"other": "Weitere"`
- fr: `"other": "Autres"`
- pt-BR: `"other": "Outros"`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/MetadataForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite + typecheck + lint**

Run:
```bash
cd apps/desktop && npx tsc --build && npx biome check --write src/renderer/src/components/MetadataForm.tsx src/renderer/src/components/MetadataForm.test.tsx src/renderer/src/i18n/locales/*.json
node ../../node_modules/vitest/vitest.mjs run
```
Expected: tsc exit 0, biome clean, full suite green (existing `field-compilation` tests still pass because renderField keeps that testid; no test asserted the old `<h3 data-testid=field-group-*>` shape).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/MetadataForm.tsx apps/desktop/src/renderer/src/components/MetadataForm.test.tsx apps/desktop/src/renderer/src/i18n/locales/*.json
git commit -m "Agrupar los metadatos en secciones plegables por categoría"
```

---

### Task 4: Verify in the real app (both themes, worst case)

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `cd apps/desktop && PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
Expected: `✓ built`.

- [ ] **Step 2: Drive with all fields on**

Use the run-desktop skill / a Playwright one-off: open a track, enable all fields via Settings → Fields (or inject `visibleFields` = all), and screenshot the metadata panel in dark. Confirm: four group headers (Identity/Catalog/DJ/Order), only Identity open, each collapsed header shows "N con datos", clicking a header expands it. Confirm the panel is short by default (no infinite column).

- [ ] **Step 3: Report**

Report the before/after height and that headers no longer repeat.

---

## Self-Review

- **Spec coverage:** groupFields (Task 1) = "agrupar de verdad, 1 header por grupo, orden fijo, other bucket". Collapsible + Identity-open-default + count (Task 3) = decision "Solo Identidad abierto" + "N con datos". i18n (Tasks 2, 3.4) = count string + other label in all 5 locales (parity test). ✔
- **Placeholder scan:** all code shown in full; no TBD. ✔
- **Type consistency:** `groupFields<T extends {key}>` returns `FieldGroupBucket<T>[]`; consumed as `FieldGroupBucket<FieldSpec>` in Task 3. `FieldSpec.value` is a string (has `.trim()`). ✔
- **Ambiguity:** fold state is local `useState`, non-persistent (per agreed decision); MetadataForm is remounted per track by the editor (keyed), so state resets per track without extra work. ✔
