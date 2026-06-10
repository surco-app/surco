import { useEffect, useState } from 'react'

// PayPal sends donors here after a completed donation. Thank them properly and
// celebrate: two confetti volleys rise from the bottom corners toward the center.
// canvas-confetti touches window at import time, so it's loaded inside the effect —
// the SSG pass never sees it. Self-contained bilingual copy, like DonateCancel.
const COPY = {
  es: {
    title: '¡Gracias de corazón!',
    body: 'Tu donación es lo que mantiene Surco vivo: horas de desarrollo, nuevas funciones y cero suscripciones. Que te ahorre muchas horas de cabina.',
    home: 'Volver al inicio',
  },
  en: {
    title: 'Thank you so much!',
    body: 'Your donation is what keeps Surco alive: development hours, new features and zero subscriptions. May it save you many booth hours.',
    home: 'Back to home',
  },
}

// Detected after hydration: Node ≥21 defines a global navigator, so a render-time
// check would leak the build machine's language into the prerendered HTML.
function useLang(): 'es' | 'en' {
  const [lng, setLng] = useState<'es' | 'en'>('es')
  useEffect(() => {
    if (navigator.language.toLowerCase().startsWith('en')) setLng('en')
  }, [])
  return lng
}

export default function DonateCompleted() {
  const t = COPY[useLang()]

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    import('canvas-confetti').then(({ default: confetti }) => {
      if (cancelled) return
      const volley = (): void => {
        confetti({ particleCount: 70, angle: 60, spread: 55, origin: { x: 0, y: 1 } })
        confetti({ particleCount: 70, angle: 120, spread: 55, origin: { x: 1, y: 1 } })
      }
      volley()
      timers.push(setTimeout(volley, 350), setTimeout(volley, 700))
    })
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">{t.body}</p>
      <a href="/" className="mt-10 text-sm text-faint transition-colors hover:text-blue">
        ← {t.home}
      </a>
    </main>
  )
}
