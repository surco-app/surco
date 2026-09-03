import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TAG_ARTIST, TAG_MATCHES, TAG_TITLE, TAG_TOTAL, tagFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import AppFrame from './AppFrame'
import CoverArt from './CoverArt'

// One input as the app draws it: a plain sentence-case label above a filled box that
// holds its height whether or not it has a value. Empty ones stay on screen — a form
// that only renders the fields this release happens to fill reads as a summary, not
// as the editor the visitor will actually meet.
function Field({
  label,
  children,
  accent,
  caret,
}: {
  label: string
  children: React.ReactNode
  accent?: 'green' | 'red'
  caret?: boolean
}) {
  const value = accent === 'green' ? 'text-green' : accent === 'red' ? 'text-red' : 'text-fg/90'
  return (
    <div className="min-w-0">
      <span className="block text-[10px] text-muted">{label}</span>
      <div
        className={`mt-0.5 rounded border bg-bg/60 px-1.5 py-1 transition-colors duration-500 ${
          accent === 'green' ? 'border-green/45' : 'border-line'
        }`}
      >
        <span className={`block min-h-[1.05rem] truncate font-mono ${value}`}>
          {children}
          {caret && (
            <span
              aria-hidden="true"
              className="ml-px inline-block h-3 w-px translate-y-0.5 bg-green"
            />
          )}
        </span>
      </div>
    </div>
  )
}

// The whole act, in order: the query types itself, releases arrive one by one, one
// gets picked, and the artwork and fields land as its consequence. The previous
// version opened on results already listed and panels already resolved — the outcome
// of a click the visitor never saw, with a before/after floating free of any file.
export default function TagScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const progress = useSceneProgress(ref, 6400)
  const frame = tagFrame(progress)
  const done = progress >= 1

  const fieldLabels = [
    t('home.tag.fields.label'),
    t('home.tag.fields.bpm'),
    t('home.tag.fields.key'),
    t('home.tag.fields.year'),
  ]

  return (
    <AppFrame
      pill={`${frame.done}/${TAG_TOTAL}`}
      busy={!done}
      progress={(frame.done / TAG_TOTAL) * 100}
    >
      <div ref={ref} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          {/* The search field, typing itself. Without it the results are a list that
              was always there, and "in one click" has no click to point at. */}
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-2 py-1.5 font-mono text-[11px]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className="size-3 shrink-0 text-faint"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-fg/90">
              {frame.query}
              {!frame.picked && (
                <span
                  aria-hidden="true"
                  className="ml-px inline-block h-3 w-px translate-y-0.5 bg-blue"
                  style={{ animation: 'glow 1s steps(2) infinite' }}
                />
              )}
            </span>
          </div>

          <div className="space-y-1.5">
            {TAG_MATCHES.map((r, i) => {
              const shown = i < frame.results
              const active = frame.picked ? i === 0 : frame.activeRow === i
              return (
                <div
                  key={r.src}
                  className={`flex items-center gap-2 rounded-lg border p-2 font-mono text-[11px] transition-all duration-300 ${
                    shown
                      ? 'translate-y-0 opacity-100'
                      : 'pointer-events-none translate-y-1 opacity-0'
                  } ${active ? 'border-blue/45 bg-blue/10' : 'border-line'}`}
                >
                  {i === 0 ? (
                    <CoverArt className="size-7 shrink-0 rounded" />
                  ) : (
                    <span className="size-7 shrink-0 rounded bg-surface" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg/90">{r.title}</span>
                    <span className="block truncate text-[10px] text-faint">{r.meta}</span>
                  </span>
                  {frame.picked && i === 0 ? (
                    <span className="shrink-0 rounded-full bg-blue px-1.5 text-[9px] text-bg">
                      {t('home.tag.applied')}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-line px-1.5 text-[9px] text-faint">
                      {r.src}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* The editor panel as the app lays it out: a METADATOS heading, the title
            across the full width, artwork beside the fields, and labelled inputs in
            two columns — including the ones this release leaves empty. Six free
            floating cards were a diagram of a form rather than the form. */}
        <div className="text-[11px]">
          <p className="border-b border-line pb-1.5 font-mono text-[9px] tracking-[0.14em] text-faint uppercase">
            {t('home.tag.section')}
          </p>

          {/* One grid for the whole block, artwork included: separate grids gave each
              row a different column width, so no input lined up with the one above
              it. Every field sits in columns 2-3 and the artwork holds column 1, so
              the left edge of the form is a single line all the way down. */}
          <div className="mt-2.5 grid grid-cols-[4.6rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2">
            {/* The artwork tops the column, level with the first field rather than
                starting halfway down the form — it belongs to the whole release, not
                to the row it happens to sit beside. */}
            <div className="col-start-1 row-start-1 row-span-3">
              <div className="relative size-[4.6rem] overflow-hidden rounded border border-line bg-bg/60">
                <div
                  className="size-full"
                  style={{
                    opacity: frame.artwork,
                    transform: `scale(${0.92 + frame.artwork * 0.08})`,
                  }}
                >
                  <CoverArt className="size-full" />
                </div>
              </div>
              <p className="mt-1 text-center font-mono text-[9px] text-faint tabular-nums">
                {frame.artwork > 0 ? '1/4' : '0/4'}
              </p>
            </div>

            <div className="col-start-2 col-span-2 row-start-1">
              <Field label={t('home.tag.titleField')}>{TAG_TITLE}</Field>
            </div>

            {/* One field, overwritten in place — the same single Artista input the
                app has. A before box and an after box explain the swap; watching
                the value be rewritten is the swap. */}
            <Field
              label={t('home.tag.artistField')}
              accent={frame.picked ? 'green' : 'red'}
              caret={frame.picked && frame.artist !== TAG_ARTIST}
            >
              {frame.artist}
            </Field>
            <Field label={fieldLabels[3]}>{frame.fields[3]}</Field>
            <Field label={fieldLabels[0]}>{frame.fields[0]}</Field>
            <Field label={fieldLabels[1]}>{frame.fields[1]}</Field>
            {/* The artwork's three rows end above this one, so without pinning it the
                row would start in column 1 and sit left of every field above it. */}
            <div className="col-start-2">
              <Field label={fieldLabels[2]}>{frame.fields[2]}</Field>
            </div>
            <Field label={t('home.tag.catalogField')}>{frame.fields[0] ? 'FT-012' : ''}</Field>
          </div>
        </div>
      </div>
    </AppFrame>
  )
}
