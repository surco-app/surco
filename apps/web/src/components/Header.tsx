import { useEffect, useState } from 'react'
import { SECTIONS } from '../lib/nav'

export default function Header() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
          <span
            className={`font-semibold tracking-tight transition-all duration-300 ${
              scrolled ? 'text-2xl' : 'text-3xl'
            }`}
          >
            Surco
          </span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-muted lg:flex">
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-fg">
              {label}
            </a>
          ))}
          <span className="cursor-not-allowed rounded-full border border-line bg-surface/50 px-4 py-1.5 font-medium text-muted">
            Pronto
          </span>
        </nav>
      </div>
    </header>
  )
}
