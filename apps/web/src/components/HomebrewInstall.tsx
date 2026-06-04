import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'

const COMMAND = 'brew install --cask vigosan/surco/surco'

export default function HomebrewInstall() {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  // Clipboard only exists on the client and on secure origins; the handler runs
  // on click, so prerendering stays untouched and a missing API just no-ops.
  const copy = () => {
    void navigator.clipboard?.writeText(COMMAND).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <section id="instalar" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('homebrew.kicker')}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{t('homebrew.title')}</h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">{t('homebrew.lede')}</p>
      </Reveal>

      <Reveal delay={120}>
        <div className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface2/50 px-5 py-4">
          <code className="overflow-x-auto font-mono text-sm whitespace-nowrap text-fg">
            <span className="select-none text-faint">$ </span>
            {COMMAND}
          </code>
          <button
            type="button"
            onClick={copy}
            data-testid="copy-brew"
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-blue/50 hover:text-fg"
          >
            {copied ? t('homebrew.copied') : t('homebrew.copy')}
          </button>
        </div>
        <p className="mt-4 font-mono text-xs text-faint">{t('homebrew.note')}</p>
      </Reveal>
    </section>
  )
}
