import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DONATE_URL } from '../config'
import { HEADER_SECTIONS, PAGES, type Page } from '../lib/nav'
import { rememberLanguage } from '../lib/useAutoLanguage'

// `page` marks which standalone page renders the header; section links then
// point back to the landing instead of to anchors that don't exist here.
export default function Header({ page }: { page?: Page }) {
  const { t, i18n } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const otherCode = lang === 'en' ? 'es' : 'en'
  const otherLabel = lang === 'en' ? 'ES' : 'EN'
  const home = lang === 'en' ? '/en' : '/'
  const otherHref = page ? PAGES[page][otherCode] : lang === 'en' ? '/' : '/en'
  const sectionHref = (id: string) => (page ? `${home}#${id}` : `#${id}`)
  const guideHref = PAGES.guide[lang]
  const changelogHref = PAGES.changelog[lang]

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
      window.location.href = otherHref + window.location.hash
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
        <a href={page ? home : '#top'} className="flex items-center gap-3">
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
            {HEADER_SECTIONS.map((id) => (
              <a key={id} href={sectionHref(id)} className="transition-colors hover:text-fg">
                {t(`nav.${id}`)}
              </a>
            ))}
            <a href={guideHref} className="transition-colors hover:text-fg">
              {t('nav.guia')}
            </a>
            <a href={changelogHref} className="transition-colors hover:text-fg">
              {t('nav.cambios')}
            </a>
          </nav>
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full bg-blue px-3.5 py-2 text-xs font-semibold text-bg transition-[background-color,scale] duration-200 hover:bg-cyan active:scale-[0.96] sm:inline-flex"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {t('nav.donar')}
          </a>
          <a
            href={otherHref}
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
            {HEADER_SECTIONS.map((id) => (
              <a
                key={id}
                href={sectionHref(id)}
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
            <a
              href={changelogHref}
              onClick={() => setOpen(false)}
              className="block py-3 text-sm text-muted transition-colors hover:text-fg"
            >
              {t('nav.cambios')}
            </a>
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 py-3 text-sm text-blue transition-colors hover:text-cyan"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              {t('nav.donar')}
            </a>
          </div>
        </nav>
      )}
    </header>
  )
}
