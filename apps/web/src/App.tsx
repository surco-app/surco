const features = [
  {
    title: 'Importa y arrastra',
    body: 'Suelta tus WAV, FLAC o AIFF. Surco lee las etiquetas y la carátula embebida al instante.'
  },
  {
    title: 'Metadatos desde Discogs',
    body: 'Busca el disco y trae artista, álbum, año, género y carátula con un clic.'
  },
  {
    title: 'AIFF lossless',
    body: 'Convierte preservando la profundidad de bits exacta. Misma calidad bit a bit, cero pérdida.'
  },
  {
    title: 'Carátula embebida',
    body: 'La portada y las etiquetas viajan dentro del archivo, visibles en Apple Music y rekordbox.'
  },
  {
    title: 'Directo a Apple Music',
    body: 'Añade la pista ya etiquetada a tu biblioteca automáticamente al terminar.'
  },
  {
    title: 'Espectrograma anti-fake',
    body: 'Visualiza el espectro y detecta transcodificaciones y MP3 disfrazados de lossless.'
  }
]

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-brand/40">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-ink text-white antialiased">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] opacity-60"
        style={{
          background:
            'radial-gradient(60% 60% at 50% 0%, rgba(248,111,44,0.28) 0%, rgba(11,12,15,0) 70%)'
        }}
      />

      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="Surco" className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">Surco</span>
        </div>
        <nav className="hidden gap-8 text-sm text-white/60 sm:flex">
          <a href="#features" className="hover:text-white">Funciones</a>
          <a href="#why" className="hover:text-white">Por qué AIFF</a>
        </nav>
      </header>

      <main className="relative mx-auto max-w-5xl px-6">
        <section className="flex flex-col items-center pt-16 pb-24 text-center sm:pt-24">
          <img
            src="/icon.png"
            alt="Surco"
            className="h-32 w-32 drop-shadow-[0_20px_60px_rgba(248,111,44,0.35)] sm:h-40 sm:w-40"
          />
          <h1 className="mt-10 max-w-2xl text-4xl font-bold tracking-tight sm:text-6xl">
            Cuida tus pistas de DJ
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/60">
            Surco convierte a AIFF lossless, etiqueta desde Discogs y manda tu música a Apple Music
            — con la carátula y la info siempre en su sitio.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <a
              href="#"
              className="rounded-full bg-brand px-7 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.03]"
            >
              Descargar para macOS
            </a>
            <span className="text-xs text-white/40">Apple Silicon · macOS</span>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 pb-24">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Todo el flujo, en una app
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Feature key={f.title} title={f.title} body={f.body} />
            ))}
          </div>
        </section>

        <section
          id="why"
          className="scroll-mt-20 rounded-3xl border border-white/10 bg-white/[0.03] p-10 sm:p-14"
        >
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Por qué AIFF y no WAV</h2>
          <p className="mt-4 max-w-3xl leading-relaxed text-white/60">
            WAV no tiene un estándar fiable de metadatos: Apple Music suele ignorar las etiquetas y la
            carátula. AIFF es <span className="text-white">el mismo audio PCM sin comprimir</span> —
            idéntico bit a bit, misma calidad — pero con soporte sólido de ID3 que tanto Apple Music
            como rekordbox leen perfectamente.
          </p>
        </section>

        <footer className="flex flex-col items-center gap-2 py-16 text-center text-sm text-white/40">
          <img src="/icon.png" alt="" className="h-6 w-6 opacity-70" />
          <span>Surco — hecho para DJs cuidadosos.</span>
        </footer>
      </main>
    </div>
  )
}
