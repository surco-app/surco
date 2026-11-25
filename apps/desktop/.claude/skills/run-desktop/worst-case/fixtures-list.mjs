import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ffmpeg = createRequire(resolve(import.meta.dirname, '../../../../../../package.json'))('ffmpeg-static')
const root = process.argv[2] ?? join(process.env.WORST_DIR ?? '/tmp/surco-worst-case', 'fx')
const mk = (dir, name, secs, tags) => {
  const out = join(dir, name)
  const args = ['-y', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${secs}:sample_rate=44100`]
  if (name.endsWith('.mp3')) args.push('-ac', '1', '-b:a', secs > 600 ? '8k' : '128k', '-id3v2_version', '3')
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`)
  args.push(out)
  execFileSync(ffmpeg, args, { stdio: 'ignore' })
  return out
}
const demo = join(root, 'demo'), worst = join(root, 'worst'), one = join(root, 'one'), big = join(root, 'big')
for (const d of [demo, worst, one, big]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }) }
const DEMO = [
  ['Pray', 'Tina Cousins', '8A'], ['Strings of Life', 'Rhythim Is Rhythim', '11B'], ['Windowlicker', 'Aphex Twin', '4A'],
  ['Spastik', 'Plastikman', '6A'], ['Born Slippy', 'Underworld', '9B'], ['Energy Flash', 'Joey Beltram', '1A'],
]
DEMO.forEach(([title, artist, TKEY], i) => mk(demo, `${String(i + 1).padStart(2, '0')}.mp3`, 6, { title, artist, TKEY }))
const W = [
  ['01.mp3', 8, { title: 'Strings of Life (Derrick May & Carl Craig Re-Edit - Extended Unreleased Dub Version) [Remastered 2026]', artist: 'Rhythim Is Rhythim feat. Kenny Larkin, Juan Atkins, Kevin Saunderson & Blake Baxter', TKEY: '8A' }],
  ['02.mp3', 1, { title: 'U', artist: 'Jo', TKEY: 'Ebm/D#m' }],
  ['03.mp3', 6, { title: '夜明けのダンスフロアで踊り続ける私たちの永遠のメロディー（エクステンデッド・ミックス）', artist: '坂本龍一・細野晴臣・高橋幸宏', TKEY: 'C# minor' }],
  ['04.mp3', 6, { title: 'ليلة في القاهرة (ريمكس ممتد)', artist: 'عمرو دياب وفرقة القاهرة الموسيقية', TKEY: '11B' }],
  ['01-unknown_artist-untitled_track-vinyl_rip_24bit_96khz_final_FINAL_v2.flac', 6, {}],
  ['06.mp3', 6, { title: 'Đêm Trắng Sài Gòn (Ngọc Hân Rework)', artist: 'Đặng Thị Ngọc Hân', TKEY: 'Ab minor / G# minor' }],
  ['07.mp3', 6, { title: '🔥 Fuego 🔥 (VIP Mix)', artist: '👩🏽‍💻 DJ Priya', TKEY: '3A' }],
  ['08.mp3', 6, { title: '<b>Bass</b> &amp; **Drop**', artist: 'Above & Beyond', TKEY: '5A' }],
  ['09.mp3', 6, { title: 'Untitled', artist: 'Tanzmusikproduktionsgemeinschaftsveranstaltungen', TKEY: '12A' }],
  ['10.mp3', 7200, { title: 'Live at Fabric London, 6 Hour Closing Set (Part 1 of 3)', artist: 'Ricardo Villalobos', TKEY: '1B' }],
  ['11.mp3', 6, { title: 'Line one\nLine two', artist: 'Newline Artist', TKEY: '2A' }],
  ['12.mp3', 6, { title: '   ', artist: '   ', TKEY: '' }],
  ['13.opus', 6, { title: 'Intro', artist: 'Various Artists' }],
  ['14.m4a', 6, { title: 'Intro', artist: 'Various Artists' }],
  ['15.wav', 6, { title: 'Sin etiquetas en WAV', artist: '' }],
  ['16.aiff', 6, { title: 'Ólafur Darri: Þórsmörk (Original Mix)', artist: 'Ólafur Arnalds & Nils Frahm' }],
]
for (const [n, s, t] of W) mk(worst, n, s, t)
mk(one, '01.mp3', 6, { title: 'Pray', artist: 'Tina Cousins', TKEY: '8A' })
const seed = mk(big, 'seed.mp3', 6, { title: 'Seed', artist: 'Seed' })
for (let i = 0; i < 1000; i++) {
  const w = W[i % W.length]
  const src = join(worst, w[0])
  const ext = w[0].slice(w[0].lastIndexOf('.'))
  execFileSync('cp', ['-c', src, join(big, `${String(i).padStart(4, '0')}${ext}`)])
}
rmSync(seed)
const marks = join(root, 'marks')
rmSync(marks, { recursive: true, force: true })
mkdirSync(marks, { recursive: true })
mk(marks, '01.mp3', 8, { title: 'Strings of Life', artist: 'Rhythim  Is  Rhythim feat.  Kenny Larkin ', TKEY: 'Ab minor / G# minor', album: 'Innovator' })
copyFileSync(join(marks, '01.mp3'), join(marks, '01 copy.mp3'))
mk(marks, '02.mp3', 8, { title: 'Pray', artist: 'Tina Cousins', TKEY: '8A' })
console.log('ok')
