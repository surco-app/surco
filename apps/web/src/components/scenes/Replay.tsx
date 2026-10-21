import { Fragment, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AnchorLink({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <a
      href={`#${id}`}
      data-testid="scene-anchor"
      aria-label={t('home.anchorLink')}
      className="ml-2 font-normal text-faint transition-colors hover:text-blue"
    >
      #
    </a>
  )
}

export function Replayable({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [run, setRun] = useState(0)
  return (
    <>
      <Fragment key={run}>{children}</Fragment>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          data-testid="scene-replay"
          onClick={() => setRun((n) => n + 1)}
          className="rounded-lg border border-line bg-surface2/60 px-3 py-1.5 font-mono text-xs text-muted transition-[color,border-color,scale] duration-200 hover:border-blue/40 hover:text-fg active:scale-[0.96]"
        >
          {t('home.replay')}
        </button>
      </div>
    </>
  )
}
