import AppMockup from './components/AppMockup'
import Spectrogram from './components/Spectrogram'
import Speed from './components/Speed'

const features = [
  { kick: 'importar', title: 'Arrastra y suelta', body: 'Suelta tus WAV, FLAC o AIFF. Surco lee al vuelo las etiquetas y la carátula que ya traen.' },
  { kick: 'discogs', title: 'Metadatos de Discogs', body: 'Busca el disco y trae artista, álbum, año, género y carátula con un clic.' },
  { kick: 'exportar', title: 'AIFF lossless o MP3', body: 'Exporta sin pérdida en AIFF (PCM, profundidad de bits exacta) o en MP3 de alta calidad cuando buscas ligereza.' },
  { kick: 'carátula', title: 'Carátula embebida', body: 'Portada y tags viajan dentro del archivo (ID3v2.3), visibles en Apple Music y rekordbox.' },
  { kick: 'biblioteca', title: 'Directo a Apple Music', body: 'Manda la pista ya etiquetada a tu biblioteca, lista para pinchar.' },
  { kick: 'espectro', title: 'Análisis de espectro', body: 'Mira el espectro y caza el MP3 recomprimido que se hace pasar por lossless.' }
]

const shortcuts: [string[], string][] = [
  [['⌘', 'O'], 'Añadir archivos'],
  [['⌘', '↵'], 'Procesar pista'],
  [['⌘', '⇧', '↵'], 'Procesar todas'],
  [['Espacio'], 'Reproducir / pausa'],
  [['J', 'K'], 'Navegar pistas'],
  [['/'], 'Buscar en Discogs']
]

const stack = ['AIFF lossless', 'MP3 320', 'ffmpeg incluido', 'ID3v2.3', 'Discogs', 'Apple Silicon']

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-fg shadow-sm">
      {k}
    </kbd>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[720px]"
        style={{
          background:
            'radial-gradient(55% 50% at 70% 0%, rgba(122,162,247,0.18) 0%, rgba(26,27,38,0) 70%)'
        }}
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="Surco" className="h-14 w-14" />
          <span className="text-3xl font-semibold tracking-tight">Surco</span>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
          <a href="#velocidad" className="hover:text-fg">Velocidad</a>
          <a href="#analisis" className="hover:text-fg">Análisis</a>
          <a href="#funciones" className="hover:text-fg">Funciones</a>
          <a href="#atajos" className="hover:text-fg">Atajos</a>
          <span className="cursor-not-allowed rounded-full border border-line bg-surface/50 px-4 py-1.5 font-medium text-muted">
            Pronto
          </span>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="grid items-center gap-12 pt-12 pb-24 lg:grid-cols-2 lg:pt-20">
          <div className="reveal">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue/40 bg-blue/10 px-3 py-1 font-mono text-xs text-blue">
              <span
                className="h-1.5 w-1.5 rounded-full bg-blue"
                style={{ animation: 'glow 2s ease-in-out infinite' }}
              />
              Próximamente · macOS · Apple Silicon
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
              Menos preparar,
              <br />
              <span className="text-blue">más pinchar.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
              Surco convierte tus descargas a AIFF lossless o MP3, las etiqueta desde Discogs y las
              deja listas en Apple Music — y te avisa si una pista viene falseada.
            </p>
            <div className="mt-5 font-mono text-sm text-muted">
              <span className="text-fg">WAV</span> · <span className="text-fg">FLAC</span> ·{' '}
              <span className="text-fg">AIFF</span> <span className="text-blue">→</span>{' '}
              <span className="text-cyan">AIFF lossless</span> <span className="text-muted">o</span>{' '}
              <span className="text-cyan">MP3</span>
            </div>
            <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="cursor-not-allowed rounded-full bg-surface px-7 py-3 text-sm font-semibold text-muted ring-1 ring-line"
              >
                Descargar para macOS
              </button>
              <a href="#analisis" className="text-sm font-medium text-fg hover:text-blue">
                Ver el análisis →
              </a>
            </div>
            <p className="mt-4 font-mono text-xs text-muted">
              La descarga aún no está disponible — estamos puliendo la primera versión.
            </p>
          </div>

          <div className="reveal" style={{ animationDelay: '0.12s' }}>
            <AppMockup />
          </div>
        </section>

        <Speed />

        <section id="analisis" className="scroll-mt-20 pb-24">
          <p className="font-mono text-xs tracking-wider text-blue uppercase">Análisis anti-fake</p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            El espectro no miente
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            Un MP3 recomprimido a WAV/AIFF arrastra un corte brusco en altas frecuencias. Surco lo
            mide y marca la pista como sospechosa antes de que acabe sonando en cabina.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface2/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-xs text-muted">original.flac</span>
                <span className="rounded-full bg-green/15 px-2.5 py-0.5 font-mono text-[11px] text-green">
                  ● buena calidad
                </span>
              </div>
              <Spectrogram />
              <p className="mt-3 font-mono text-xs text-muted">
                energía hasta <span className="text-fg">~22 kHz</span> (Nyquist) — banda completa.
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-surface2/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-xs text-muted">descarga_320.aiff</span>
                <span className="rounded-full bg-red/15 px-2.5 py-0.5 font-mono text-[11px] text-red">
                  ● sospechoso
                </span>
              </div>
              <div className="relative">
                <Spectrogram suspect />
                <div className="pointer-events-none absolute inset-x-0" style={{ top: '32%' }}>
                  <div className="border-t border-dashed border-red/80" />
                  <span className="absolute right-1 -top-5 rounded bg-red/20 px-1.5 py-0.5 font-mono text-[10px] text-red">
                    muro ~16 kHz
                  </span>
                </div>
              </div>
              <p className="mt-3 font-mono text-xs text-muted">
                corte brusco en <span className="text-red">~16 kHz</span> — delata un MP3 recomprimido.
              </p>
            </div>
          </div>
        </section>

        <section id="funciones" className="scroll-mt-20 pb-24">
          <p className="font-mono text-xs tracking-wider text-blue uppercase">Funciones</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Todo el flujo, en una app
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.kick}
                className="rounded-2xl border border-line bg-surface2/40 p-6 transition-colors hover:border-blue/50"
              >
                <div className="font-mono text-xs text-blue">{f.kick}</div>
                <h3 className="mt-2 text-lg font-semibold text-fg">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="atajos" className="scroll-mt-20 pb-24">
          <div className="grid gap-10 rounded-3xl border border-line bg-surface2/40 p-8 sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="font-mono text-xs tracking-wider text-blue uppercase">Teclado primero</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Vuela sin tocar el ratón
              </h2>
              <p className="mt-3 leading-relaxed text-muted">
                Una paleta de comandos y atajos para todo el flujo. Añade, etiqueta, analiza y procesa
                pista tras pista sin soltar las manos del teclado.
              </p>
            </div>
            <div className="space-y-2.5">
              {shortcuts.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between rounded-xl bg-bg/50 px-4 py-2.5">
                  <span className="text-sm text-fg">{label}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((k) => (
                      <Kbd key={k} k={k} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-24">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {stack.map((s) => (
              <span
                key={s}
                className="rounded-full border border-line bg-surface/40 px-4 py-1.5 font-mono text-xs text-muted"
              >
                {s}
              </span>
            ))}
          </div>
        </section>

      </main>

      <footer className="relative mt-8 border-t border-line/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/icon.png" alt="Surco" className="h-9 w-9" />
              <span className="text-lg font-semibold tracking-tight">Surco</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Convierte, etiqueta y organiza tus pistas de DJ — listas para pinchar en segundos.
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/40 px-3 py-1 font-mono text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-blue" style={{ animation: 'glow 2s ease-in-out infinite' }} />
              Próximamente · macOS
            </p>
          </div>

          <div>
            <h3 className="font-mono text-xs tracking-wider text-muted uppercase">Producto</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li><a href="#velocidad" className="hover:text-fg">Velocidad</a></li>
              <li><a href="#analisis" className="hover:text-fg">Análisis</a></li>
              <li><a href="#funciones" className="hover:text-fg">Funciones</a></li>
              <li><a href="#atajos" className="hover:text-fg">Atajos</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-mono text-xs tracking-wider text-muted uppercase">Formatos</h3>
            <ul className="mt-4 space-y-2.5 font-mono text-sm text-muted">
              <li>AIFF lossless</li>
              <li>MP3 320</li>
              <li>etiquetas Discogs</li>
              <li>a Apple Music</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-line/60">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-muted sm:flex-row">
            <span>© 2026 Surco · getsurco.app</span>
            <span className="text-muted/80">del crate a la cabina</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
