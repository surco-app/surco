// The queue column, with the same states the real app shows: a skeleton while tags
// are still being read, an amber ring while a track converts, a filled coin once
// it's done, a red stripe on anything the quality pass flagged.
//
// Track names are real files from a 90s eurodance crate, because a list of
// "Artist 01 - Track 01" is the fastest way to tell a DJ this is a mockup.
export type Row = {
  name: string
  state?: 'idle' | 'loading' | 'working' | 'done' | 'flagged'
  format?: string
  duration?: string
  stage?: string
  progress?: number
  selected?: boolean
}

function Coin({ state }: { state: Row['state'] }) {
  if (state === 'done')
    return (
      <span className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-blue text-[7px] text-bg">
        ✓
      </span>
    )
  if (state === 'working')
    return (
      <span
        aria-hidden="true"
        className="absolute -right-1 -bottom-1 size-3 rounded-full border-[1.5px] border-amber"
        style={{ animation: 'glow 1.4s ease-in-out infinite' }}
      />
    )
  return null
}

export default function TrackRows({ rows }: { rows: Row[] }) {
  return (
    <ul className="space-y-0.5 p-2 font-mono text-[11px]">
      {rows.map((r) => (
        <li
          key={r.name}
          className={`relative flex items-center gap-2.5 rounded-md px-2 py-1.5 ${
            r.selected ? 'bg-blue/15' : ''
          }`}
        >
          {r.state === 'flagged' && (
            <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-red" />
          )}
          <span className="relative size-6 shrink-0 rounded bg-surface">
            <Coin state={r.state} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-fg/90">{r.name}</span>
            {r.state === 'loading' && (
              <span
                aria-hidden="true"
                className="mt-1 block h-1 w-16 rounded-full bg-line"
                style={{ animation: 'glow 1.4s ease-in-out infinite' }}
              />
            )}
            {r.stage && (
              <>
                <span className="mt-0.5 block text-[10px] text-blue">{r.stage}</span>
                <span aria-hidden="true" className="mt-1 block h-0.5 rounded-full bg-blue/25">
                  <span
                    className="block h-full rounded-full bg-blue"
                    style={{ width: `${r.progress ?? 0}%` }}
                  />
                </span>
              </>
            )}
          </span>
          {r.state === 'flagged' && <span className="shrink-0 text-red">◆</span>}
          {/* Fixed width, whether or not the length has been read yet: the badges to
              its right would otherwise shift sideways as each row finishes. */}
          {r.duration !== undefined && (
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-faint">
              {r.duration}
            </span>
          )}
          {r.format && (
            <span className="w-11 shrink-0 rounded border border-line px-1.5 text-center text-[9px] text-muted">
              {r.format}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
