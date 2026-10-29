import { LIGHT_SPECTRUM_RAMP as ramp } from '../lib/spectrumDuotone'

// The filter the light theme draws the spectrum images through (index.css applies it to
// .spectrum-duotone). The images ship already colored for the dark page, so they are turned
// back to gray first: the app's ramp is keyed on the intensity of a grayscale map. Their navy
// body grays to about 0.1, where the ramp's low end would sink it into the page along with
// the noise, so a gamma lifts it to the ~0.3 the app's own gray map gives a song's body
// before the ramp. sRGB interpolation keeps the table values mapping straight to the tokens.
export default function SpectrumDuotone() {
  return (
    <svg aria-hidden="true" className="absolute size-0">
      <filter id="spectrum-duotone" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="gamma" exponent="0.55" />
          <feFuncG type="gamma" exponent="0.55" />
          <feFuncB type="gamma" exponent="0.55" />
        </feComponentTransfer>
        <feComponentTransfer>
          <feFuncR type="table" tableValues={ramp.r} />
          <feFuncG type="table" tableValues={ramp.g} />
          <feFuncB type="table" tableValues={ramp.b} />
        </feComponentTransfer>
      </filter>
    </svg>
  )
}
