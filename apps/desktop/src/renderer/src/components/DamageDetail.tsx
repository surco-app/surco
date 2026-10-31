import type { TFunction } from 'i18next'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DamageFinding, DamageKind, DamageNote } from '../../../shared/types'
import type { MusicReview as Review } from '../hooks/useMusicReview'
import { damageKey } from '../lib/damageReview'
import { PILL_TEXT, TonePill } from './ListRow'
import { GroupFooter, Header } from './MusicReviewDetail'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { Select } from './Select'

const KIND_LABEL: Record<DamageKind, string> = {
  'genre-number': 'genre',
  'genre-parens': 'genre',
  'traktor-source-cues': 'traktor',
  'traktor-calibration': 'traktor',
  'engine-cues': 'engineCues',
  'engine-length': 'engineLength',
}

export const damageKindLabel = (kind: DamageKind): string => KIND_LABEL[kind]

export function damageNote(t: TFunction, lang: string, note: DamageNote): string {
  const params = Object.fromEntries(
    Object.entries(note.params ?? {}).map(([name, value]) => [
      name,
      typeof value !== 'number'
        ? value
        : name === 'date'
          ? new Date(value).toLocaleDateString(lang, { day: 'numeric', month: 'numeric' })
          : name === 'number'
            ? String(value)
            : new Intl.NumberFormat(lang, { maximumFractionDigits: 3 }).format(value),
    ]),
  )
  return t(note.key, params)
}

export const damageTitle = (review: Review, path: string): string =>
  review.facts(path)?.meta.title || path.split('/').pop() || path

export function DamageCertainty({ finding }: { finding: DamageFinding }) {
  const { t } = useTranslation()
  if (finding.pending)
    return (
      <span data-testid="damage-row-pending" className="shrink-0 text-xs text-fg-faint">
        {t('damage.pending')}
      </span>
    )
  return (
    <TonePill testid="music-review-row-pill" tone={finding.certainty === 'sure' ? 'good' : 'warn'}>
      <span
        data-testid="damage-row-certainty"
        data-tone={finding.certainty === 'sure' ? 'good' : 'warn'}
        className={PILL_TEXT}
      >
        {t(`damage.certainty.${finding.certainty}`)}
      </span>
    </TonePill>
  )
}

export function DamageDetail({ finding, review }: { finding: DamageFinding; review: Review }) {
  const { t, i18n } = useTranslation()
  const optionsId = useId()
  const evidenceId = useId()
  const [open, setOpen] = useState({ options: true, evidence: true })
  const toggle = (section: keyof typeof open) => setOpen((o) => ({ ...o, [section]: !o[section] }))
  const key = damageKey(finding)
  const busy = review.status === 'applying'
  const staged = review.staged.has(key)
  const chosen = review.choice(key)
  const note = (n: DamageNote) => damageNote(t, i18n.language, n)
  const after =
    finding.repair?.target === 'genre'
      ? (chosen ?? finding.options[0])
      : finding.after && note(finding.after)
  return (
    <>
      <div data-testid="damage-detail" className="min-h-0 flex-1 overflow-y-auto p-7">
        <Header
          name={damageTitle(review, finding.path)}
          detail={t(`damage.kind.${damageKindLabel(finding.kind)}`)}
        />
        <SectionHeader
          title={t('musicReview.detail.options')}
          open={open.options}
          onToggle={() => toggle('options')}
          bodyId={optionsId}
          status={<DamageCertainty finding={finding} />}
        />
        <SectionBody open={open.options} id={optionsId}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 pt-3 text-sm">
            <dt className="text-fg-faint">{t('musicReview.detail.now')}</dt>
            <dd
              data-testid="damage-before"
              className="whitespace-pre-wrap text-[var(--color-warn)]"
            >
              {note(finding.before)}
            </dd>
            {after && (
              <>
                <dt className="text-fg-faint">{t('musicReview.detail.after')}</dt>
                <dd
                  data-testid="damage-after"
                  className="whitespace-pre-wrap text-[var(--color-good)]"
                >
                  {after}
                </dd>
              </>
            )}
          </dl>
          {finding.repair?.target === 'genre' && finding.options.length > 1 && (
            <div className="pt-3">
              <Select
                testid="damage-option"
                value={chosen ?? finding.options[0]}
                onChange={(value) => review.choose(key, value)}
                label={t('musicReview.detail.after')}
                options={finding.options.map((value) => ({ value, label: value }))}
              />
            </div>
          )}
        </SectionBody>
        <div className="mt-6 border-t border-[var(--color-line)] pt-6">
          <SectionHeader
            title={t('damage.evidenceTitle')}
            open={open.evidence}
            onToggle={() => toggle('evidence')}
            bodyId={evidenceId}
          />
          <SectionBody open={open.evidence} id={evidenceId}>
            <ul className="grid gap-1 pt-3 text-sm text-fg-dim">
              {finding.evidence.map((n) => (
                <li key={n.key} data-testid="damage-evidence">
                  {note(n)}
                </li>
              ))}
            </ul>
          </SectionBody>
        </div>
      </div>
      {finding.repair && !finding.pending ? (
        <GroupFooter
          testid="damage-stage"
          label={staged ? t('musicReview.staged') : t('damage.repair')}
          disabled={busy}
          onStage={() => review.toggleStaged(key)}
          menuLabel={t('musicReview.ignore')}
          menuDisabled={busy}
          onMenu={() => review.ignore(key)}
        />
      ) : (
        !finding.pending && (
          <p data-testid="damage-warn-only" className="px-7 pb-6 text-xs text-fg-faint">
            {t('damage.warnOnly')}
          </p>
        )
      )}
    </>
  )
}
