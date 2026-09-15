import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { replaceFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'

// The rekordbox row following the new file. The path crosses over from the MP3 to the
// AIFF while the two counts a DJ cares about — the crates the track sits in and the
// cues placed on it — visibly do not move.
//
// Those counts carry the argument. Saying "it keeps your playlists" is a claim; showing
// the file name change with the numbers held still is the proof, and it is exactly the
// loss the visitor is afraid of when they think about re-importing a better rip.
export default function ReplaceScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = replaceFrame(useSceneProgress(ref, 3600))

  return (
    <div ref={ref} className="p-5">
      <p className="truncate text-xs text-muted">{t('home.replace.rowTitle')}</p>

      {/* Both paths occupy one grid cell so the row never changes height as they cross:
          a line that grows mid-animation would read as the app rewriting the row, when
          the point is that the row is the same one it always was. */}
      <div className="mt-3">
        <p className="font-mono text-[10px] tracking-wider text-faint uppercase">
          {t('home.replace.fileLabel')}
        </p>
        <div className="mt-1 grid">
          <span
            className="col-start-1 row-start-1 truncate font-mono text-[11px] text-muted line-through"
            style={{ opacity: frame.oldOpacity }}
          >
            {t('home.replace.oldFile')}
          </span>
          <span
            className="col-start-1 row-start-1 truncate font-mono text-[11px] text-blue"
            style={{ opacity: frame.newOpacity }}
          >
            {t('home.replace.newFile')}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3.5">
        {[
          { label: t('home.replace.playlistsLabel'), value: frame.playlists },
          { label: t('home.replace.cuesLabel'), value: frame.cues },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="font-mono text-[10px] tracking-wider text-faint uppercase">{label}</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-fg">{value}</p>
            <p
              className="mt-0.5 font-mono text-[10px] text-green transition-opacity duration-500"
              style={{ opacity: frame.swapped ? 1 : 0 }}
            >
              {t('home.replace.intact')}
            </p>
          </div>
        ))}
      </div>

      {/* Why it works, and the one thing it does not cover. rekordbox re-derives the
          beatgrid from the new file, so the cues survive but the ruler under them can
          move — saying so here costs a line and saves the visitor discovering it on
          their own crate. */}
      <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-pretty text-faint">
        {t('home.replace.note')}
      </p>
    </div>
  )
}
