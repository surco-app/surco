import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TAG_ARTIST, TAG_MATCHES, TAG_TITLE, TAG_TOTAL, tagFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import AppFrame from './AppFrame'

// One input as the app draws it: a plain sentence-case label beside a filled box that
// holds its height whether or not it has a value. Empty ones stay on screen — a form
// that only renders the fields this release happens to fill reads as a summary, not
// as the editor the visitor will actually meet.
//
// The label sits to the LEFT of the box, not above it. Stacked, each field needed its
// own two rows, so fitting them meant two narrow columns and every value — "Factory
// Team", the title, even "Ken Laszlo" — was truncated to two characters and an
// ellipsis. A row per field spends the width on the value instead.
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
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-right text-[10px] text-muted">{label}</span>
      <div
        className={`min-w-0 flex-1 rounded border bg-bg/60 px-2 py-1 transition-colors duration-500 ${
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
// gets picked, and the fields land as its consequence. The previous version opened on
// results already listed and panels already resolved — the outcome of a click the
// visitor never saw, with a before/after floating free of any file.
//
// Results on top, the form below, both full width: side by side inside a 648px frame
// left each column near 300px, which is narrower than the values it had to show.
export default function TagScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const progress = useSceneProgress(ref, 6400)
  const frame = tagFrame(progress)
  const done = progress >= 1

  return (
    <AppFrame
      pill={`${frame.done}/${TAG_TOTAL}`}
      busy={!done}
      progress={(frame.done / TAG_TOTAL) * 100}
    >
      <div ref={ref} className="space-y-3 p-4">
        {/* The search field, typing itself. Without it the results are a list that
            was always there, and "in one click" has no click to point at. */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-2.5 py-1.5 font-mono text-[11px]">
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

        <div className="grid gap-1.5 sm:grid-cols-3">
          {TAG_MATCHES.map((r, i) => {
            const shown = i < frame.results
            const active = frame.picked ? i === 0 : frame.activeRow === i
            return (
              <div
                key={r.src}
                className={`min-w-0 rounded-lg border p-2 font-mono text-[11px] transition-all duration-300 ${
                  shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
                } ${active ? 'border-blue/45 bg-blue/10' : 'border-line'}`}
              >
                <span className="block truncate text-fg/90">{r.title}</span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[10px] text-faint">{r.meta}</span>
                  {frame.picked && i === 0 ? (
                    <span className="shrink-0 rounded-full bg-blue px-1.5 text-[9px] text-bg">
                      {t('home.tag.applied')}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-line px-1.5 text-[9px] text-faint">
                      {r.src}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        {/* The editor panel as the app lays it out: a METADATOS heading and labelled
            inputs, one per row, including the ones this release leaves empty. Six free
            floating cards were a diagram of a form rather than the form. */}
        <div className="text-[11px]">
          <p className="border-b border-line pb-1.5 font-mono text-[9px] tracking-[0.14em] text-faint uppercase">
            {t('home.tag.section')}
          </p>

          {/* The title spans both columns — it is the longest value on the form and the
              one a DJ scans first. The rest pair up. */}
          <div className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
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
            <Field label={t('home.tag.fields.label')}>{frame.fields[0]}</Field>
            <Field label={t('home.tag.fields.year')}>{frame.fields[3]}</Field>
            <Field label={t('home.tag.fields.bpm')}>{frame.fields[1]}</Field>
          </div>
        </div>
      </div>
    </AppFrame>
  )
}
