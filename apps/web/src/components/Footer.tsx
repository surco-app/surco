import { SECTIONS } from '../lib/nav'

const formats = ['AIFF lossless', 'MP3 alta calidad', 'etiquetas Discogs', 'a Apple Music']

export default function Footer() {
  return (
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
            Disponible · macOS · Windows
          </p>
        </div>

        <div>
          <h3 className="font-mono text-xs tracking-wider text-faint uppercase">Producto</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {SECTIONS.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="transition-colors hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-mono text-xs tracking-wider text-faint uppercase">Formatos</h3>
          <ul className="mt-4 space-y-2.5 font-mono text-sm text-muted">
            {formats.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-faint sm:flex-row">
          <span>© 2026 Surco · getsurco.app</span>
          <span>del crate a la cabina</span>
        </div>
      </div>
    </footer>
  )
}
