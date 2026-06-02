const manualSteps = [
  { app: 'otra app', label: 'Convertir a AIFF', t: '~60 s' },
  { app: 'app de tags', label: 'Escribir los metadatos', t: '~60 s' },
  { app: 'a mano', label: 'Añadir grouping y tags que el tagger no pone', t: '~45 s' },
  { app: 'Música', label: 'Importar a Apple Music', t: '~30 s' }
]

export default function Speed() {
  return (
    <section id="velocidad" className="scroll-mt-20 pb-24">
      <p className="font-mono text-xs tracking-wider text-blue uppercase">Un botón</p>
      <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
        De minutos a segundos por pista
      </h2>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
        A mano es un proceso de varios pasos —convertir, etiquetar, completar tags, subir— saltando
        entre herramientas. Tedioso en cuanto lo repites pista tras pista. Surco lo hace todo al
        pulsar un botón.
      </p>

      <div className="mt-10 grid items-stretch gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface2/40 p-6">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-fg">A mano</span>
            <span className="font-mono text-sm text-red">~3–4 min</span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {manualSteps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 rounded-lg bg-bg/50 px-3 py-2">
                <span className="font-mono text-[10px] text-muted">{s.t}</span>
                <span className="text-sm text-fg">{s.label}</span>
                <span className="ml-auto font-mono text-[10px] text-muted">{s.app}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-red/70"
              style={{ animation: 'fillSlow 6s linear infinite' }}
            />
          </div>
          <p className="mt-2 font-mono text-[10px] text-muted">saltando entre herramientas · repitiendo en cada pista</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-blue/40 bg-surface2/40 p-6">
          <div
            className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue/15 blur-2xl"
            style={{ animation: 'glow 4s ease-in-out infinite' }}
          />
          <div className="relative flex items-baseline justify-between">
            <span className="text-sm font-semibold text-fg">Con Surco</span>
            <span className="font-mono text-sm text-cyan">~1–2 s</span>
          </div>
          <div className="relative mt-4 flex items-center gap-3 rounded-xl border border-blue/40 bg-blue/10 px-4 py-3">
            <span className="font-mono text-xs text-blue">▶</span>
            <span className="text-sm font-medium text-fg">Convertir + etiquetar + Apple Music</span>
            <span
              className="ml-auto text-green"
              style={{ animation: 'popcheck 6s ease-out infinite' }}
            >
              ✓
            </span>
          </div>
          <ul className="relative mt-4 grid grid-cols-2 gap-2 font-mono text-[11px] text-muted">
            <li>· AIFF lossless o MP3</li>
            <li>· metadatos Discogs</li>
            <li>· carátula embebida</li>
            <li>· grouping y tags</li>
            <li>· análisis de espectro</li>
            <li>· a Apple Music</li>
          </ul>
          <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue to-cyan"
              style={{ animation: 'fillSnap 6s ease-out infinite' }}
            />
          </div>
          <p className="relative mt-2 font-mono text-[10px] text-muted">un clic · una pista lista</p>
        </div>
      </div>

      <p className="mt-4 font-mono text-[11px] text-muted">
        * Flujo a mano a modo de ejemplo; los pasos y herramientas varían según cada quien. Tiempos
        estimados.
      </p>
    </section>
  )
}
