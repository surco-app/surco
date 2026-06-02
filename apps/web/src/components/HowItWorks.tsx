import Reveal from './Reveal'

const steps = [
  { n: '1', title: 'Suelta tus pistas', body: 'Arrastra tus WAV, FLAC o AIFF. Surco lee al vuelo las etiquetas y la carátula.' },
  { n: '2', title: 'Elige el disco', body: 'Busca en Discogs y aplica artista, álbum, año, género y carátula con un clic.' },
  { n: '3', title: 'Pulsa una vez', body: 'Convierte a AIFF o MP3, revisa el espectro y manda la pista a Apple Music.' }
]

export default function HowItWorks() {
  return (
    <section id="como" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">Cómo funciona</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Tres pasos y a pinchar</h2>
      </Reveal>

      <div className="relative mt-12 grid gap-8 md:grid-cols-3">
        <div className="pointer-events-none absolute top-6 right-8 left-8 hidden h-px bg-gradient-to-r from-transparent via-line to-transparent md:block" />
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 120}>
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue/40 bg-bg font-mono text-lg text-blue">
                {s.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
