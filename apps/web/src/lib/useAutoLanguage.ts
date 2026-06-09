import { useEffect } from 'react'

// First-visit language detection for the marketing site. With no saved choice, an
// English-preferring browser landing on the Spanish default (`/`) is sent to `/en`
// once. We never redirect away from `/en` (so shared English links are respected) and
// never override a manual choice the header switch persisted via rememberLanguage.
const KEY = 'surco_lang'

export function rememberLanguage(lang: 'es' | 'en'): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // private mode / storage disabled — the choice just won't persist
  }
}

export function useAutoLanguage(): void {
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return
    } catch {
      return
    }
    const onDefault = !window.location.pathname.startsWith('/en')
    const prefersEn = !navigator.language.toLowerCase().startsWith('es')
    if (onDefault && prefersEn) {
      window.location.replace(`/en${window.location.hash}`)
    }
  }, [])
}
