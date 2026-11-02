export const CONVERT_PAGES = [
  'convert',
  'flacToAiff',
  'wavToAiff',
  'flacToMp3',
  'wavToMp3',
] as const

export type ConvertPage = (typeof CONVERT_PAGES)[number]

type Side = { format: string; spec: string }

export const INPUT_FORMATS = ['WAV', 'FLAC', 'AIFF', 'ALAC', 'MP3', 'M4A', 'AAC', 'OGG', 'OPUS']
export const OUTPUT_FORMATS = ['AIFF', 'WAV', 'FLAC', 'ALAC', 'MP3']

const LOSSLESS = '16-bit / 44.1 kHz · 7:08'
const MP3 = '320 kbps · 7:08'

export const CONVERT_EXAMPLES: Record<Exclude<ConvertPage, 'convert'>, [Side, Side]> = {
  flacToAiff: [
    { format: 'FLAC', spec: LOSSLESS },
    { format: 'AIFF', spec: LOSSLESS },
  ],
  wavToAiff: [
    { format: 'WAV', spec: LOSSLESS },
    { format: 'AIFF', spec: LOSSLESS },
  ],
  flacToMp3: [
    { format: 'FLAC', spec: LOSSLESS },
    { format: 'MP3', spec: MP3 },
  ],
  wavToMp3: [
    { format: 'WAV', spec: LOSSLESS },
    { format: 'MP3', spec: MP3 },
  ],
}

export function otherConversions(page: ConvertPage): ConvertPage[] {
  return CONVERT_PAGES.filter((other) => other !== page)
}
