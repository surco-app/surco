import Spectrogram from './Spectrogram'

const tracks = [
  { n: '01', title: 'Till I Come', artist: 'ATB', state: 'done' },
  { n: '02', title: 'Café Del Mar', artist: 'Energy 52', state: 'active' },
  { n: '03', title: 'Silence', artist: 'Delerium', state: 'idle' }
]

const fields: [string, string][] = [
  ['title', 'Café Del Mar'],
  ['artist', 'Energy 52'],
  ['album', 'Cafe Del Mar — Vol. 2'],
  ['year', '1998'],
  ['genre', 'Trance']
]

export default function AppMockup() {
  return (
    <div
      className="w-full rounded-2xl border border-line bg-surface2/90 shadow-2xl shadow-black/50 backdrop-blur"
      style={{ animation: 'float 7s ease-in-out infinite' }}
    >
      <div className="flex items-center gap-2 border-b border-line/80 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red/90" />
        <span className="h-3 w-3 rounded-full bg-[#e0af68]/90" />
        <span className="h-3 w-3 rounded-full bg-green/90" />
        <span className="ml-2 font-mono text-xs text-muted">Surco</span>
      </div>

      <div className="grid grid-cols-[1.05fr_1.35fr] gap-px bg-line/60">
        <div className="bg-bg/60 p-3">
          <div className="mb-2 font-mono text-[10px] tracking-wider text-muted uppercase">Pistas</div>
          <div className="space-y-1.5">
            {tracks.map((t) => (
              <div
                key={t.n}
                className={`rounded-lg border px-2.5 py-2 ${
                  t.state === 'active'
                    ? 'border-blue/50 bg-blue/10'
                    : 'border-transparent bg-surface/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted">{t.n}</span>
                  <span className="truncate text-xs font-medium text-fg">{t.title}</span>
                  {t.state === 'done' && <span className="ml-auto text-green">✓</span>}
                </div>
                <div className="truncate pl-6 text-[10px] text-muted">{t.artist}</div>
                {t.state === 'active' && (
                  <div className="mt-1.5 ml-6 h-1 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue to-cyan"
                      style={{ animation: 'fill 3.5s ease-out infinite' }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-bg/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-wider text-muted uppercase">Metadatos</span>
            <span className="rounded-full bg-green/15 px-2 py-0.5 font-mono text-[9px] text-green">
              ● buena calidad
            </span>
          </div>

          <div className="space-y-1">
            {fields.map(([k, v], i) => (
              <div key={k} className="flex items-center gap-2 rounded-md bg-surface/40 px-2 py-1">
                <span className="w-12 shrink-0 font-mono text-[9px] text-muted">{k}</span>
                <span className="truncate text-[11px] text-fg">{v}</span>
                {i === 1 && (
                  <span className="ml-auto h-3 w-px bg-cyan" style={{ animation: 'blink 1.1s step-end infinite' }} />
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-line/70 bg-bg2/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[9px] text-muted">
              <span>espectro</span>
              <span className="text-cyan">→ 21.4 kHz</span>
            </div>
            <Spectrogram />
          </div>
        </div>
      </div>
    </div>
  )
}
