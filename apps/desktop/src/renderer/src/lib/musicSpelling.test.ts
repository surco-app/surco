import { describe, expect, it } from 'vitest'
import type { ReviewEntry } from '../../../shared/types'
import { replaceAct, SAFE_KINDS, spellingGroups, splitActs, withinOneEdit } from './musicSpelling'

let n = 0
function entry(over: Partial<ReviewEntry>): ReviewEntry {
  n += 1
  return {
    id: n.toString(16).toUpperCase().padStart(16, '0'),
    title: `T${n}`,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    ...over,
  }
}
const many = (count: number, over: Partial<ReviewEntry>) =>
  Array.from({ length: count }, () => entry(over))
const byField = (groups: ReturnType<typeof spellingGroups>, field: string) =>
  groups.filter((g) => g.field === field)

describe('splitActs / replaceAct', () => {
  it('splits a collaboration into its acts', () => {
    expect(splitActs('DJ Lara, DJ Sergi Val')).toEqual(['DJ Lara', 'DJ Sergi Val'])
    expect(splitActs('OceanLab x Ferry Corsten')).toEqual(['OceanLab', 'Ferry Corsten'])
    expect(splitActs('Alex C. Feat. Yasmin K.')).toEqual(['Alex C.', 'Yasmin K.'])
  })

  it('renames one act and leaves the rest of the credit as it was written', () => {
    expect(replaceAct('Dj Lara, DJ Sergi Val', 'Dj Lara', 'DJ Lara')).toBe('DJ Lara, DJ Sergi Val')
    expect(replaceAct('Dj Laraa & Dj Lara', 'Dj Lara', 'DJ Lara')).toBe('Dj Laraa & DJ Lara')
  })
})

describe('replacement values', () => {
  it('writes a name with dollar signs literally', () => {
    expect(replaceAct('Kesha, DJ X', 'Kesha', 'Ke$$ha')).toBe('Ke$$ha, DJ X')
    expect(replaceAct('Asap & DJ X', 'Asap', 'A$AP $&')).toBe('A$AP $& & DJ X')
  })
})

describe('SAFE_KINDS', () => {
  it('never lets a typo be applied without review', () => {
    expect([...SAFE_KINDS].sort()).toEqual(['case', 'invisible', 'punctuation'])
    expect(SAFE_KINDS.has('typo')).toBe(false)
  })
})

describe('spellingGroups', () => {
  it('flags a bidi control as invisible', () => {
    for (const mark of ['\u202a', '\u202e', '\u2066', '\u2069']) {
      const [g] = spellingGroups([entry({ artist: `Ana${mark} Ruiz` })])
      expect(g.kind).toBe('invisible')
      expect(g.suggested).toBe('Ana Ruiz')
    }
  })

  it('flags leading and trailing spaces as invisible', () => {
    const [g] = spellingGroups([entry({ album: ' Connected Vol.3 ' })])
    expect(g.kind).toBe('invisible')
    expect(g.suggested).toBe('Connected Vol.3')
  })

  it('groups the same act written with other capitals and suggests the common spelling', () => {
    const groups = spellingGroups([
      ...many(11, { artist: 'DJ Lara' }),
      entry({ artist: 'Dj Lara' }),
    ])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('case')
    expect(g.suggested).toBe('DJ Lara')
    expect(g.variants.map((v) => [v.value, v.ids.length])).toEqual([
      ['DJ Lara', 11],
      ['Dj Lara', 1],
    ])
  })

  it('finds an act inside a collaboration', () => {
    const groups = spellingGroups([
      ...many(3, { artist: 'DJ Lara' }),
      entry({ artist: 'Dj Lara, DJ Sergi Val' }),
    ])
    expect(byField(groups, 'artist')[0].variants.map((v) => v.value)).toEqual([
      'DJ Lara',
      'Dj Lara',
    ])
  })

  // Measured on the real library: "Christian Millán" twice, one composed and one not.
  it('treats a composed and a decomposed accent as two spellings of one name', () => {
    const groups = spellingGroups([
      entry({ albumArtist: 'Christian Mill\u00e1n' }),
      entry({ albumArtist: 'Christian Milla\u0301n' }),
    ])
    expect(byField(groups, 'albumArtist')[0].kind).toBe('case')
  })

  it('calls an apostrophe or a space a punctuation difference', () => {
    const groups = spellingGroups([
      ...many(44, { artist: "Head Horny's" }),
      ...many(5, { artist: 'Head Horny\u00b4s' }),
    ])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('punctuation')
    expect(g.suggested).toBe("Head Horny's")
  })

  it('flags invisible characters even when nothing else is spelled differently', () => {
    const groups = spellingGroups([entry({ artist: 'Aar\u200b\u00f3\u200bn Alfonso' })])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('invisible')
    expect(g.suggested).toBe('Aar\u00f3n Alfonso')
  })

  it('checks titles for invisible characters only', () => {
    const groups = spellingGroups([
      entry({ title: 'El Trayon 2\u200b.\u200b0' }),
      entry({ title: 'Bleeding Love' }),
      entry({ title: 'bleeding love' }),
    ])
    const titles = byField(groups, 'title')
    expect(titles).toHaveLength(1)
    expect(titles[0].suggested).toBe('El Trayon 2.0')
  })

  it('suggests a likely typo but never marks it safe and names no winner on a tie', () => {
    const groups = spellingGroups([
      ...many(2, { artist: 'Rachel Auburn' }),
      ...many(2, { artist: 'Rahcel Auburn' }),
    ])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('typo')
    expect(g.suggested).toBeNull()
  })

  it('does not swallow a safe case fix into a typo group, and keeps two DJs apart', () => {
    const groups = spellingGroups([
      ...many(4, { artist: 'DJ Napo' }),
      ...many(1, { artist: 'Dj Napo' }),
      ...many(2, { artist: 'DJ Nano' }),
    ])
    const artists = byField(groups, 'artist')
    expect(artists).toHaveLength(1)
    expect(artists[0].kind).toBe('case')
    expect(artists[0].variants.map((v) => v.value).sort()).toEqual(['DJ Napo', 'Dj Napo'])
  })

  it('lists one variant per cluster in a typo group, leaving the accent fix to its own group', () => {
    const groups = byField(
      spellingGroups([
        ...many(6, { artist: 'Álex Cervera' }),
        ...many(2, { artist: 'Alex Cervera' }),
        ...many(1, { artist: 'Álex Cevera' }),
      ]),
      'artist',
    )
    const safe = groups.find((g) => g.kind === 'case')
    const typo = groups.find((g) => g.kind === 'typo')
    expect(safe?.variants.map((v) => v.value).sort()).toEqual(['Alex Cervera', 'Álex Cervera'])
    expect(typo?.variants.map((v) => [v.value, v.ids.length])).toEqual([
      ['Álex Cervera', 6],
      ['Álex Cevera', 1],
    ])
  })

  it('does not treat short names after a DJ or MC prefix as typos', () => {
    const pairs = [
      ['DJ Kim', 'DJ Tim'],
      ['DJ Jan', 'DJ Jean'],
      ['DJ Ben', 'DJ Nen'],
      ['DJ Miho', 'DJ Miko'],
      ['MC Kim', 'Mc Tim'],
    ]
    for (const [a, b] of pairs)
      expect(spellingGroups([entry({ artist: a }), entry({ artist: b })]), `${a}/${b}`).toEqual([])
  })

  it('still compares the full name when only one side has the prefix, or the prefix is inside a word', () => {
    expect(
      byField(
        spellingGroups([entry({ artist: 'Djagoo Mix' }), entry({ artist: 'Djagao Mix' })]),
        'artist',
      ),
    ).toHaveLength(1)
    expect(
      byField(
        spellingGroups([entry({ artist: 'DJ Rachel' }), entry({ artist: 'Rahcel' })]),
        'artist',
      ),
    ).toEqual([])
    expect(
      byField(
        spellingGroups([
          entry({ artist: 'Djangoo Reinhardt' }),
          entry({ artist: 'Djongoo Reinhardt' }),
        ]),
        'artist',
      ),
    ).toHaveLength(1)
  })

  it('counts an adjacent swap as a single slip, so Rachel and Rahcel Auburn are one name', () => {
    const groups = spellingGroups([
      entry({ artist: 'Rachel Auburn' }),
      entry({ artist: 'Rahcel Auburn' }),
    ])
    expect(byField(groups, 'artist').map((g) => g.kind)).toEqual(['typo'])
  })

  it('treats two long names that differ only by a swapped adjacent pair as one typo group', () => {
    const groups = spellingGroups([
      entry({ album: 'Greatest Hits' }),
      entry({ album: 'Greatest Hist' }),
    ])
    expect(byField(groups, 'album').map((g) => g.kind)).toEqual(['typo'])
  })

  it('catches a dropped letter and a split title in long names', () => {
    expect(
      byField(
        spellingGroups([entry({ artist: 'Álex Cervera' }), entry({ artist: 'Álex Cevera' })]),
        'artist',
      ),
    ).toHaveLength(1)
    expect(
      byField(
        spellingGroups([
          entry({ artist: 'Chumi DJ Present' }),
          entry({ artist: 'Chumi DJ Presenta' }),
        ]),
        'artist',
      ),
    ).toHaveLength(1)
  })

  it('keeps distinct real artists and genres apart, because a wrong merge rewrites the wrong person', () => {
    const pairs = [
      ['Katana', 'Kavana'],
      ['Cascada', 'Cascade'],
      ['Zentral', 'Central'],
      ['Solid', 'Sound Solution'],
      ['Black House', 'Black Rose'],
    ]
    for (const [a, b] of pairs)
      expect(spellingGroups([entry({ artist: a }), entry({ artist: b })]), `${a}/${b}`).toEqual([])
  })

  it('never offers a typo group for genres', () => {
    expect(
      spellingGroups([entry({ genre: 'Euro House' }), entry({ genre: 'Afro House' })]),
    ).toEqual([])
    expect(
      spellingGroups([entry({ genre: 'Hard Trance' }), entry({ genre: 'Hard Dance' })]),
    ).toEqual([])
  })

  it('does not call two names a typo when their numbers differ', () => {
    expect(
      spellingGroups([entry({ album: 'Hits Vol 1' }), entry({ album: 'Hits Vol 2' })]),
    ).toEqual([])
  })

  it('keeps albums of different artists apart', () => {
    const groups = spellingGroups([
      entry({ album: 'Need You', albumArtist: 'A' }),
      entry({ album: 'NEED YOU', albumArtist: 'B' }),
    ])
    expect(byField(groups, 'album')).toEqual([])
  })

  it('leaves a genre with several values alone', () => {
    const groups = spellingGroups([
      entry({ genre: 'Electronic, Latin, Pop' }),
      entry({ genre: 'electronic, latin, pop' }),
    ])
    expect(byField(groups, 'genre')).toEqual([])
  })

  it('gives the same group the same key on every read, so an ignore sticks', () => {
    const make = () =>
      spellingGroups([...many(2, { genre: 'Electronic' }), entry({ genre: 'electronic' })])
    expect(make()[0].key).toBe(make()[0].key)
  })

  it('reports nothing for a clean library', () => {
    expect(spellingGroups([...many(3, { artist: 'DJ Lara', album: 'X', genre: 'House' })])).toEqual(
      [],
    )
  })
})

describe('cost', () => {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const SYL = [
    'ka',
    'lo',
    'mi',
    'ra',
    'sen',
    'tor',
    'vel',
    'dan',
    'ri',
    'us',
    'mar',
    'tin',
    'el',
    'go',
    'ber',
  ]
  const word = (n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += SYL[Math.floor(rnd() * SYL.length)]
    return s[0].toUpperCase() + s.slice(1)
  }

  // A crate dragged in from a NAS reaches thousands of tracks; the review opens on the
  // list's own thread, so grouping has to stay well under a second. Measured 1.45 s before.
  it('groups 5000 tracks with 2000 distinct artists in under 1.5 s', () => {
    const artists = Array.from({ length: 2000 }, () => `${word(2)} ${word(2)}`)
    const entries: ReviewEntry[] = Array.from({ length: 5000 }, (_, i) => {
      const artist = artists[Math.floor(rnd() * artists.length)]
      return {
        id: `/music/${i}.mp3`,
        title: `${word(3)} ${word(2)}`,
        artist,
        albumArtist: rnd() < 0.5 ? artist : '',
        album: word(3),
        genre: ['House', 'Techno', 'Trance', 'Hard House', 'Electronic'][i % 5],
        durationSec: 200 + Math.floor(rnd() * 300),
      }
    })
    spellingGroups(entries)
    const start = performance.now()
    spellingGroups(entries)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1500)
  })

  // The fast check must be the same rule, not a cousin of it: a looser one invents typo
  // groups between different artists, a stricter one hides real typos.
  it('answers one edit exactly like the full distance does', () => {
    const osa = (a: string, b: string): number => {
      const d: number[][] = []
      for (let i = 0; i <= a.length; i++) {
        d.push([i])
        for (let j = 1; j <= b.length; j++) {
          if (i === 0) {
            d[0].push(j)
            continue
          }
          let best = Math.min(
            d[i - 1][j] + 1,
            d[i][j - 1] + 1,
            d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
          )
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
            best = Math.min(best, d[i - 2][j - 2] + 1)
          d[i].push(best)
        }
      }
      return d[a.length][b.length]
    }
    const pick = (n: number) =>
      Array.from({ length: n }, () => 'ab1c'[Math.floor(rnd() * 4)]).join('')
    for (let k = 0; k < 20000; k++) {
      const a = pick(Math.floor(rnd() * 7))
      const b = rnd() < 0.5 ? pick(Math.floor(rnd() * 7)) : a.slice(0, 2) + pick(1) + a.slice(3)
      expect(withinOneEdit(a, b), `${a} / ${b}`).toBe(osa(a, b) <= 1)
    }
  })
})
