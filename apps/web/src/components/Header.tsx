import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SECTIONS } from '../lib/nav'
import { rememberLanguage } from '../lib/useAutoLanguage'

export default function Header() {
  const { t, i18n } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const otherLang = i18n.language === 'en' ? '/' : '/en'
  const otherLabel = i18n.language === 'en' ? 'ES' : 'EN'
  const otherCode = i18n.language === 'en' ? 'es' : 'en'
  const guideHref = i18n.language === 'en' ? '/en/guide' : '/guia'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keep the in-page anchor when switching language: both pages share the same
  // section ids, so we send the visitor to the same spot on the other locale.
  const keepHash = (e: React.MouseEvent) => {
    // A manual switch is an explicit choice: persist it so auto-detection never
    // overrides it on the next visit.
    rememberLanguage(otherCode)
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
        className="mx-auto flex max-w-5xl items-center justify-between px-6 transition-all duration-300"
        style={{ paddingTop: scrolled ? '0.7rem' : '1.25rem', paddingBottom: scrolled ? '0.7rem' : '1.25rem' }}
      >
        <a href="#top" className="flex items-center gap-3">
          <img
            src="/icon.png"
            alt="Surco"
            className={`transition-all duration-300 ${
              scrolled ? 'h-10 w-10' : 'h-11 w-11 sm:h-14 sm:w-14'
            }`}
          />
          <span className="flex items-center gap-2">
            <span
              className={`font-semibold leading-none tracking-tight transition-all duration-300 ${
                scrolled ? 'text-2xl' : 'text-2xl sm:text-3xl'
              }`}
            >
              Surco
            </span>
            <span className="rounded-full border border-blue/40 bg-blue/10 px-2 py-0.5 font-mono text-[10px] uppercase leading-none tracking-wider text-blue">
              {t('beta')}
            </span>
          </span>
        </a>
        <div className="flex items-center gap-4 sm:gap-7">
          <nav className="hidden items-center gap-7 text-sm text-muted lg:flex">
            {SECTIONS.map((id) => (
              <a key={id} href={`#${id}`} className="transition-colors hover:text-fg">
                {t(`nav.${id}`)}
              </a>
            ))}
            <a href={guideHref} className="transition-colors hover:text-fg">
              {t('nav.guia')}
            </a>
          </nav>
          <a
            href={otherLang}
            onClick={keepHash}
            className="inline-flex items-center rounded-full border border-line px-3 py-2 font-mono text-xs text-muted transition-colors hover:border-blue/50 hover:text-fg"
          >
            {otherLabel}
          </a>
          <button
            type="button"
            aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-blue/50 hover:text-fg lg:hidden"
          >
            {open ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          className="border-t border-line/70 bg-bg/95 backdrop-blur-md lg:hidden"
        >
          <div className="mx-auto max-w-5xl px-6 py-2">
            {SECTIONS.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={() => setOpen(false)}
                className="block py-3 text-sm text-muted transition-colors hover:text-fg"
              >
                {t(`nav.${id}`)}
              </a>
            ))}
            <a
              href={guideHref}
              onClick={() => setOpen(false)}
              className="block py-3 text-sm text-muted transition-colors hover:text-fg"
            >
              {t('nav.guia')}
            </a>
          </div>
        </nav>
      )}
    </header>
  )
}
