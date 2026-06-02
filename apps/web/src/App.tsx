import Header from './components/Header'
import Footer from './components/Footer'
import Speed from './components/Speed'
import HowItWorks from './components/HowItWorks'
import Spectrogram from './components/Spectrogram'
import AppMockup from './components/AppMockup'
import Reveal from './components/Reveal'
import CountUp from './components/CountUp'
import ScrollProgress from './components/ScrollProgress'
import Tilt from './components/Tilt'
import DownloadButton from './components/DownloadButton'

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

const stack = ['AIFF lossless', 'MP3 alta calidad', 'ffmpeg incluido', 'ID3v2.3', 'Discogs', 'Apple Silicon']

const cardHover =
  'transition duration-200 hover:-translate-y-1 hover:border-blue/50 hover:shadow-xl hover:shadow-blue/5'

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-fg shadow-sm">
      {k}
    </kbd>
  )
}

export default function App() {
  return (
    <div id="top" className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />

      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[760px]"
        style={{
          background:
            'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.20) 0%, rgba(26,27,38,0) 70%)'
        }}
      />

      <Header />

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="grid items-center gap-12 pt-10 pb-24 lg:grid-cols-2 lg:pt-16">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue/40 bg-blue/10 px-3 py-1 font-mono text-xs text-blue">
              <span
                className="h-1.5 w-1.5 rounded-full bg-blue"
                style={{ animation: 'glow 2s ease-in-out infinite' }}
              />
              Próximamente · macOS · Windows
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
              Menos preparar,
              <br />
              <span className="text-grad">más pinchar.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
              Surco convierte tus descargas a AIFF lossless o MP3, las etiqueta desde Discogs y las
              deja listas en Apple Music — y te avisa si una pista viene falseada.
            </p>
            <div className="mt-5 font-mono text-sm text-muted">
              <span className="text-fg">WAV</span> · <span className="text-fg">FLAC</span> ·{' '}
              <span className="text-fg">AIFF</span> <span className="text-blue">→</span>{' '}
              <span className="text-cyan">AIFF lossless</span> <span className="text-faint">o</span>{' '}
              <span className="text-cyan">MP3</span>
            </div>
            <DownloadButton />
          </Reveal>

          <Reveal delay={120}>
            <Tilt>
              <AppMockup />
            </Tilt>
          </Reveal>
        </section>

        <Speed />

        <Reveal>
          <section className="pb-24">
            <div className="grid gap-8 rounded-3xl border border-line bg-surface2/40 p-10 text-center sm:grid-cols-3 sm:p-12">
              <div>
                <div className="text-4xl font-bold text-grad sm:text-5xl">
                  ~<CountUp to={100} />×
                </div>
                <p className="mt-2 text-sm text-muted">más rápido que a mano*</p>
              </div>
              <div>
                <div className="text-4xl font-bold text-fg sm:text-5xl">1–2 s</div>
                <p className="mt-2 text-sm text-muted">por pista</p>
              </div>
              <div>
                <div className="text-4xl font-bold text-fg sm:text-5xl">1</div>
                <p className="mt-2 text-sm text-muted">golpe, todo el flujo</p>
              </div>
            </div>
          </section>
        </Reveal>

        <HowItWorks />

        <section id="analisis" className="scroll-mt-24 pb-24">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">Análisis anti-fake</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
              El espectro no miente
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-muted">
              Un MP3 recomprimido a WAV/AIFF arrastra un corte brusco en altas frecuencias. Surco lo
              mide y marca la pista como sospechosa antes de que acabe sonando en cabina.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <Reveal>
              <div className={`rounded-2xl border border-line bg-surface2/50 p-4 ${cardHover}`}>
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
            </Reveal>

            <Reveal delay={120}>
              <div className={`rounded-2xl border border-line bg-surface2/50 p-4 ${cardHover}`}>
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
            </Reveal>
          </div>
        </section>

        <section id="funciones" className="scroll-mt-24 pb-24">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">Funciones</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Todo el flujo, en una app
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.kick} delay={(i % 3) * 100}>
                <div className={`h-full rounded-2xl border border-line bg-surface2/40 p-6 ${cardHover}`}>
                  <div className="font-mono text-xs text-blue">{f.kick}</div>
                  <h3 className="mt-2 text-lg font-semibold text-fg">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="atajos" className="scroll-mt-24 pb-24">
          <Reveal>
            <div className="grid gap-10 rounded-3xl border border-line bg-surface2/40 p-8 sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <p className="font-mono text-xs tracking-wider text-blue uppercase">Teclado primero</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                  Vuela sin tocar el ratón
                </h2>
                <p className="mt-3 leading-relaxed text-muted">
                  Una paleta de comandos y atajos para todo el flujo. Añade, etiqueta, analiza y
                  procesa pista tras pista sin soltar las manos del teclado.
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
          </Reveal>
        </section>

        <section className="pb-24">
          <Reveal>
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
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
