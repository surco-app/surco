import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SECTIONS } from '../lib/nav'

export default function Header() {
  const { t, i18n } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const otherLang = i18n.language === 'en' ? '/' : '/en'
  const otherLabel = i18n.language === 'en' ? 'ES' : 'EN'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keep the in-page anchor when switching language: both pages share the same
  // section ids, so we send the visitor to the same spot on the other locale.
  const keepHash = (e: React.MouseEvent) => {
    if (typeof window !== 'undefined' && window.location.hash) {
      e.preventDefault()
      window.location.href = otherLang + window.location.hash
    }
  }

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'border-b border-line/70 bg-bg/80 backdrop-blur-md' : 'border-b border-transparent'
      }`}
    >
      <div
        className="mx-auto flex max-w-6xl items-center justify-between px-6 transition-all duration-300"
        style={{ paddingTop: scrolled ? '0.7rem' : '1.25rem', paddingBottom: scrolled ? '0.7rem' : '1.25rem' }}
      >
        <a href="#top" className="flex items-center gap-3">
          <img
            src="/icon.png"
            alt="Surco"
            className={`transition-all duration-300 ${scrolled ? 'h-10 w-10' : 'h-14 w-14'}`}
          />
          <span className="flex items-baseline gap-1.5">
            <span
              className={`font-semibold tracking-tight transition-all duration-300 ${
                scrolled ? 'text-2xl' : 'text-3xl'
              }`}
            >
              Surco
            </span>
            <span className="rounded-full border border-blue/40 bg-blue/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blue">
              {t('beta')}
            </span>
          </span>
        </a>
        <div className="flex items-center gap-7">
          <nav className="hidden items-center gap-7 text-sm text-muted lg:flex">
            {SECTIONS.map((id) => (
              <a key={id} href={`#${id}`} className="transition-colors hover:text-fg">
                {t(`nav.${id}`)}
              </a>
            ))}
          </nav>
          <a
            href={otherLang}
            onClick={keepHash}
            className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition-colors hover:border-blue/50 hover:text-fg"
          >
            {otherLabel}
          </a>
        </div>
      </div>
    </header>
  )
}
