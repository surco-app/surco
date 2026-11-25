import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root = process.argv[2] ?? join(process.env.WORST_DIR ?? '/tmp/surco-worst-case', 'fx')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const tracks = Array.from({ length: 12345 }, (_, i) => ({ file: `t${i}.mp3`, title: `Track ${i}`, artist: 'Artist' }))
const keyOf = (t) => `Macintosh HD/:Users/:dj/:Music/:${t.file}`
const entryOf = (t) =>
  `<ENTRY TITLE="${t.title}" ARTIST="${t.artist}"><LOCATION DIR="/:Users/:dj/:Music/:" FILE="${t.file}" VOLUME="Macintosh HD" VOLUMEID="v"></LOCATION><INFO PLAYTIME="200" PLAYTIME_FLOAT="200.5" IMPORT_DATE="2026/1/1"></INFO></ENTRY>`
let uuid = 0
const playlist = (name, n = 3, claimed = n) =>
  `<NODE TYPE="PLAYLIST" NAME="${esc(name)}"><PLAYLIST ENTRIES="${claimed}" TYPE="LIST" UUID="u${uuid++}">${tracks
    .slice(0, n)
    .map((t) => `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${keyOf(t)}"></PRIMARYKEY></ENTRY>`)
    .join('')}</PLAYLIST></NODE>`
const folder = (name, children) =>
  `<NODE TYPE="FOLDER" NAME="${esc(name)}"><SUBNODES COUNT="${children.length}">${children.join('')}</SUBNODES></NODE>`
const nml = (nodes) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD><COLLECTION ENTRIES="${tracks.length}">${tracks.map(entryOf).join('')}</COLLECTION><PLAYLISTS>${folder('$ROOT', nodes)}</PLAYLISTS></NML>`
const write = (name, nodes) => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'collection.nml'), nml(nodes))
}
write('nml-demo', [
  playlist('Friday'),
  playlist('Warm-up', 2),
  folder('Sets', [playlist('Tresor'), playlist('Fabric', 1)]),
])
const deep = ['2026', 'Clubs', 'Berlin', 'Tresor', 'Closing', 'B2B', 'Extended', 'Final'].reduceRight(
  (inner, name) => folder(name, [inner]),
  playlist('Last record of the night'),
)
write('nml-worst', [
  playlist('Peak Time Techno — Closing Set at Fabric London (Extended B2B with Ricardo Villalobos) [2026]', 12345),
  playlist('A', 1),
  playlist('حفلة القاهرة الموسعة (النسخة الكاملة) ٢٠٢٦', 2),
  playlist('夜明けのダンスフロア・エクステンデッド・コレクション', 3),
  playlist('🔥 Bangers 🔥', 1000),
  playlist('Đêm Trắng Sài Gòn — Những Bản Phối Mới', 2),
  playlist('   ', 0),
  playlist('Empty for now', 0),
  folder('Empty folder', []),
  deep,
  folder('Weddings', [playlist('Friday'), playlist('Saturday')]),
  folder('Gigs', [playlist('Friday'), playlist('Saturday')]),
  folder('Tanzmusikproduktionsgemeinschaftsveranstaltungen', [playlist('Sonntagnachmittagsentspannungsmusik')]),
  folder('Archive', Array.from({ length: 300 }, (_, i) => playlist(`Crate ${String(i + 1).padStart(3, '0')}`, 1))),
])
write('nml-empty', [])
write('nml-one', [playlist('Friday', 1)])
console.log('ok')
