import { useState } from 'react'

// License recovery: enter the purchase email and we re-send every active license to it.
// The API always answers ok (it never reveals which emails bought), so the UI shows the
// same confirmation regardless. Self-contained bilingual copy, like CheckoutResult.
const COPY = {
  es: {
    title: 'Recupera tu licencia',
    lede: 'Introduce el email con el que compraste Surco Pro y te reenviaremos la clave.',
    placeholder: 'tu@email.com',
    submit: 'Enviar mi licencia',
    sending: 'Enviando…',
    done: 'Si ese email tiene una licencia, te la acabamos de enviar. Revisa tu bandeja de entrada.',
    home: 'Volver al inicio',
  },
  en: {
    title: 'Recover your license',
    lede: 'Enter the email you bought Surco Pro with and we will resend your key.',
    placeholder: 'you@email.com',
    submit: 'Send my license',
    sending: 'Sending…',
    done: 'If that email has a license, we just sent it. Check your inbox.',
    home: 'Back to home',
  },
}

function lang(): 'es' | 'en' {
  if (typeof navigator === 'undefined') return 'es'
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es'
}

export default function Recover() {
  const t = COPY[lang()]
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setState('sending')
    try {
      await fetch('/api/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // The endpoint is intentionally opaque; show the same confirmation on error.
    }
    setState('done')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      {state === 'done' ? (
        <p className="mt-4 leading-relaxed text-muted">{t.done}</p>
      ) : (
        <form onSubmit={submit} className="mt-4">
          <p className="leading-relaxed text-muted">{t.lede}</p>
          <input
            type="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder={t.placeholder}
            className="mt-4 w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-blue"
          />
          <button
            type="submit"
            disabled={state === 'sending'}
            className="mt-3 rounded-full bg-blue px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-cyan disabled:opacity-60"
          >
            {state === 'sending' ? t.sending : t.submit}
          </button>
        </form>
      )}
      <a href="/" className="mt-10 text-sm text-faint transition-colors hover:text-blue">
        ← {t.home}
      </a>
    </main>
  )
}
