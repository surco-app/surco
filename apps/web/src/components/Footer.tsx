import { useTranslation } from 'react-i18next'
import { SECTIONS } from '../lib/nav'

export default function Footer() {
  const { t } = useTranslation()
  const formats = t('footer.formats', { returnObjects: true }) as string[]

  return (
    <footer className="relative mt-8 border-t border-line/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/icon.png" alt="Surco" className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Surco</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            {t('footer.tagline')}
          </p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/40 px-3 py-1 font-mono text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" style={{ animation: 'glow 2s ease-in-out infinite' }} />
            {t('available')}
          </p>
        </div>

        <div>
          <h3 className="font-mono text-xs tracking-wider text-faint uppercase">{t('footer.product')}</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {SECTIONS.map((id) => (
              <li key={id}>
                <a href={`#${id}`} className="transition-colors hover:text-fg">
                  {t(`nav.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-mono text-xs tracking-wider text-faint uppercase">{t('footer.formatsHeading')}</h3>
          <ul className="mt-4 space-y-2.5 font-mono text-sm text-muted">
            {formats.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-faint sm:flex-row">
          <span>{t('footer.copyright')}</span>
          <span>{t('footer.slogan')}</span>
        </div>
      </div>
    </footer>
  )
}
