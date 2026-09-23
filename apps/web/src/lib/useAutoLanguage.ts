import { useEffect, useState } from 'react'

// First-visit language suggestion for the marketing site. With no saved choice, an
// English-preferring browser on a Spanish page is offered the English one. It is an
// offer, not a redirect: search crawlers render with an English browser, and sending
// them to /en made every Spanish page look like a redirect. A manual choice persisted
// via rememberLanguage (switching, or dismissing the offer) silences it for good.
const KEY = 'surco_lang'

export function rememberLanguage(lang: 'es' | 'en'): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // private mode / storage disabled — the choice just won't persist
  }
}

export function suggestsEnglish(saved: string | null, pathname: string, language: string): boolean {
  if (saved) return false
  const onSpanish = !pathname.startsWith('/en')
  const prefersEn = !language.toLowerCase().startsWith('es')
  return onSpanish && prefersEn
}

export function useAutoLanguage(): [boolean, () => void] {
  const [suggest, setSuggest] = useState(false)
  useEffect(() => {
    let saved: string | null
    try {
      saved = localStorage.getItem(KEY)
    } catch {
      return
    }
    setSuggest(suggestsEnglish(saved, window.location.pathname, navigator.language))
  }, [])
  const dismiss = () => {
    rememberLanguage('es')
    setSuggest(false)
  }
  return [suggest, dismiss]
}
