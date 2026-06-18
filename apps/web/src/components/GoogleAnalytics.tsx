import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { GA_MEASUREMENT_ID } from '../config'

// gtag pushes its arguments onto a global dataLayer queue; the loaded script
// drains it. Typing it as a loose tuple keeps the call sites below honest.
declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
  }
}

// Mirrors the @vercel/analytics pattern: a single component in RootLayout that
// renders nothing and loads its client script after hydration. We disable gtag's
// automatic page_view and emit one ourselves on every route change so the SPA's
// client-side navigations are counted, not just the initial document load.
export default function GoogleAnalytics() {
  const { pathname, search } = useLocation()
  const loaded = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD || loaded.current) return
    loaded.current = true

    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
    document.head.appendChild(script)

    window.dataLayer = window.dataLayer || []
    window.gtag = (...args: unknown[]) => {
      window.dataLayer.push(args)
    }
    window.gtag('js', new Date())
    window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false })
  }, [])

  useEffect(() => {
    if (!import.meta.env.PROD || typeof window.gtag !== 'function') return
    window.gtag('event', 'page_view', { page_path: pathname + search })
  }, [pathname, search])

  return null
}
