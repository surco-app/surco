import { useTranslation } from 'react-i18next'

const AXIS = ['20k', '15k', '10k', '5k', '0k']

// Both images are ffmpeg renders of the same track: the genuine FLAC, and that same
// audio pushed through MP3 128k and back. Only the codec differs, so the wall in the
// second one has no other explanation — which is the whole argument of this scene.
//
// They're rendered on a linear frequency scale on purpose. On the log scale a codec
// cutoff barely registers; linear is what makes it a straight edge you can point at.
function Spectrum({ src, alt, cutoff }: { src: string; alt: string; cutoff?: number }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-black">
      <img
        src={src}
        alt={alt}
        width={900}
        height={245}
        loading="lazy"
        decoding="async"
        className="block h-36 w-full object-cover sm:h-44"
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 flex w-8 flex-col justify-between bg-gradient-to-r from-black/70 to-transparent py-1 pl-1 font-mono text-[8px] leading-none text-fg/55"
      >
        {AXIS.map((hz) => (
          <span key={hz}>{hz}</span>
        ))}
      </div>
      {cutoff !== undefined && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 border-b border-dashed border-red"
            style={{
              height: `${cutoff}%`,
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(247,118,142,.22) 0 5px, transparent 5px 10px)',
            }}
          />
          <span
            className="absolute right-1.5 rounded bg-black/60 px-1.5 py-px font-mono text-[10px] text-red"
            style={{ top: `calc(${cutoff}% + 4px)` }}
          >
            16.0 kHz
          </span>
        </>
      )}
    </div>
  )
}

export default function SpectrumPair() {
  const { t } = useTranslation()
  return (
    <div className="space-y-5 p-4">
      <div>
        <span className="mb-2.5 inline-flex rounded-full bg-green/15 px-2.5 py-0.5 font-mono text-[11px] text-green">
          {t('home.quality.goodBadge')}
        </span>
        <Spectrum src="/spectrum/lossless-real.jpg" alt={t('home.quality.goodAlt')} />
        <p className="mt-2 font-mono text-xs text-muted">
          {t('home.quality.goodCaptionPre')}
          <span className="text-green">21.8 kHz</span>
          {t('home.quality.goodCaptionPost')}
        </p>
      </div>
      <div>
        <span className="mb-2.5 inline-flex rounded-full bg-red/15 px-2.5 py-0.5 font-mono text-[11px] text-red">
          {t('home.quality.fakeBadge')}
        </span>
        <Spectrum src="/spectrum/lossless-fake.jpg" alt={t('home.quality.fakeAlt')} cutoff={27.3} />
        <p className="mt-2 font-mono text-xs text-muted">
          {t('home.quality.fakeCaptionPre')}
          <span className="text-red">16.0 kHz</span>
          {t('home.quality.fakeCaptionPost')}
        </p>
      </div>
    </div>
  )
}
