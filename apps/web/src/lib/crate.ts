// Real tracks from a 90s and 2000s eurodance crate, with the tags and artwork their
// AIFF files carry. The scenes draw the app as it looks with a real library loaded,
// and a column of placeholder covers is the fastest way to say "mockup".
export interface CrateTrack {
  title: string
  artist: string
  duration: string
  cover: string
  album: string
  year: string
  genre: string
  label: string
}

const track = (
  key: string,
  title: string,
  artist: string,
  duration: string,
  album: string,
  year: string,
  genre: string,
  label: string,
): CrateTrack => ({
  title,
  artist,
  duration,
  cover: `/covers/${key}.webp`,
  album,
  year,
  genre,
  label,
})

export const CRATE = {
  sash: track(
    'sash',
    'Encore Une Fois (Original 12")',
    'Sash!',
    '6:26',
    'Encore Une Fois',
    '1996',
    'Euro House',
    'No Colors',
  ),
  milk: track(
    'milk',
    'The Sun Always Shines On TV (Original Extended)',
    'Milk Inc.',
    '7:12',
    'The Sun Always Shines On TV',
    '2003',
    'Electronic',
    'Antler-Subway',
  ),
  sylver: track(
    'sylver',
    "Livin' My Life (Original Extended)",
    'Sylver',
    '5:20',
    "Livin' My Life",
    '2003',
    'Trance',
    'Urban',
  ),
  lasgo: track(
    'lasgo',
    'Surrender (Extended Mix)',
    'Lasgo',
    '5:34',
    'Surrender',
    '2004',
    'Trance',
    'Positiva',
  ),
  lasgo2: track(
    'lasgo2',
    'I Wonder (Original Club Mix)',
    'Lasgo',
    '6:13',
    'I Wonder / Pray',
    '2002',
    'Trance',
    'SPG Music Productions',
  ),
  ivd: track(
    'ivd',
    'Try (Michael Woods Remix)',
    'Ian Van Dahl',
    '8:00',
    'Try',
    '2002',
    'Electronic',
    'NuLife',
  ),
  karen: track(
    'karen',
    'Natural Woman (Magic Mix)',
    'Karen B',
    '5:41',
    'Natural Woman',
    '1995',
    'Italodance',
    'Flarenasch',
  ),
  tukan: track(
    'tukan',
    'Light A Rainbow (CJ Stone Remix)',
    'Tukan',
    '8:03',
    'Light A Rainbow',
    '2001',
    'Electronic',
    'In Trance We Trust',
  ),
  bullet: track(
    'bullet',
    'Say Yeah',
    'Bulletproof',
    '7:07',
    'Say Yeah / Dance To The Rhythm',
    '2001',
    'Electronic',
    'Tidy',
  ),
  tyfoon: track(
    'tyfoon',
    'Still Remember',
    'Tyfoon',
    '5:01',
    'Rainbow / Still Remember',
    '2003',
    'Euro House',
    'Blanco Y Negro',
  ),
  katty: track(
    'katty',
    'Take On Me (Speedomix)',
    'Katty B.',
    '4:12',
    'Take On Me',
    '2008',
    'Italodance',
    '21st Century Records',
  ),
  transfer: track(
    'transfer',
    'Possession (Dececio Remix)',
    'Transfer',
    '5:23',
    'Possession',
    '2001',
    'Electronic',
    '',
  ),
} as const
