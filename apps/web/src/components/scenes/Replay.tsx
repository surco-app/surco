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
