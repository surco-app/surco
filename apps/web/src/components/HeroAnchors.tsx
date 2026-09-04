import { useTranslation } from 'react-i18next'
import Icon, { type GlyphName } from './Icon'

// The three things Surco does to a track, in the order a visitor needs them: put the
// metadata on it, improve the audio, hand it to the program they play with. It
// replaces a forty-word lede that stacked four ideas into one sentence — a paragraph
// nobody parses in the seconds they spend deciding whether to keep reading. Three
// rows with one idea each scan without being read.
//
// The weighting is the point: tagging is the headline job and carries the accent,
// the audio work is the "and it also" and stays muted. Flattening them into three
// equal bullets would say Surco is three tools, which is the confusion this fixes.
//
// One line each, not a titled block with its own paragraph: the rows sit below the
// download button now, so their job is to confirm what the visitor just read rather
// than to compete with the headline for the top of the column. The full sentences
// still live in `note`, on the features page.
const ANCHORS: { key: string; icon: GlyphName; lead?: boolean }[] = [
  { key: 'tag', icon: 'tag', lead: true },
  { key: 'audio', icon: 'spectrum' },
  { key: 'export', icon: 'upload' },
]

export default function HeroAnchors() {
  const { t } = useTranslation()

  return (
    <ul className="mt-7 flex flex-col gap-3">
      {ANCHORS.map(({ key, icon, lead }) => (
        <li key={key} className="flex items-start gap-3">
          <Icon
            name={icon}
            className={`mt-0.5 size-[17px] flex-none ${lead ? 'text-blue' : 'text-faint'}`}
          />
          <p className="text-[0.9rem] leading-snug">
            <b className="font-semibold tracking-[-0.005em]">{t(`home.anchors.${key}.lead`)}</b>{' '}
            <span className="text-faint">{t(`home.anchors.${key}.rest`)}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}
