import { useEffect, useState } from 'react'
import type { Language } from '../i18n'

// First-visit language suggestion for the marketing site. With no saved choice, a
// browser in another language on a Spanish page is offered that language when the
// site has it, and English otherwise. It is an
// offer, not a redirect: search crawlers render with an English browser, and sending
// them to /en made every Spanish page look like a redirect. A manual choice persisted
// via rememberLanguage (switching, or dismissing the offer) silences it for good.
const KEY = 'surco_lang'

export function rememberLanguage(lang: Language): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // private mode / storage disabled — the choice just won't persist
  }
}

export function suggestedLanguage(
  saved: string | null,
  pathname: string,
  language: string,
): Language | null {
  if (saved) return null
  if (/^\/(en|ja)(\/|$)/.test(pathname)) return null
  if (/^es(-|$)/i.test(language)) return null
  return /^ja(-|$)/i.test(language) ? 'ja' : 'en'
}

export function useAutoLanguage(): [Language | null, () => void] {
  const [suggest, setSuggest] = useState<Language | null>(null)
  useEffect(() => {
    let saved: string | null
    try {
      saved = localStorage.getItem(KEY)
    } catch {
      return
    }
    setSuggest(suggestedLanguage(saved, window.location.pathname, navigator.language))
  }, [])
  const dismiss = () => {
    rememberLanguage('es')
    setSuggest(null)
  }
  return [suggest, dismiss]
}
