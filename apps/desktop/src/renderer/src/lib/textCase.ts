// Title Case in the DJ-store convention (Beatport, Discogs): every word is
// capitalized — no editorial small-word lowering, which is book style, not
// music-tag style. Mixed-case words keep their internal capitals (McCoy, AceMo),
// and known DJ-culture acronyms survive whole, since an all-caps source
// ("DJ SNEAK") gives no other clue they are not plain words.
const ACRONYMS: ReadonlySet<string> = new Set([
  'DJ',
  'MC',
  'EP',
  'LP',
  'VIP',
  'UK',
  'USA',
  'NYC',
  'II',
  'III',
  'IV',
])

export function titleCase(value: string): string {
  return value.replace(/\p{L}[\p{L}'’]*/gu, (word) => {
    const upper = word.toLocaleUpperCase()
    if (ACRONYMS.has(upper)) return upper
    const flat = word === upper || word === word.toLocaleLowerCase()
    return word[0].toLocaleUpperCase() + (flat ? word.slice(1).toLocaleLowerCase() : word.slice(1))
  })
}
