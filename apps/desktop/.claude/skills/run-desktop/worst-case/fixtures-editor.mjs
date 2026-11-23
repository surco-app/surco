import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ffmpeg = createRequire(resolve(import.meta.dirname, '../../../../../../package.json'))('ffmpeg-static')
const root = process.argv[2] ?? join(process.env.WORST_DIR ?? '/tmp/surco-worst-case', 'fx')
const img = join(root, 'img')
const ed = join(root, 'editor')
const demo = join(root, 'editor-demo')
for (const d of [img, ed, demo]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }) }
const pic = (name, w, h, color) => {
  const out = join(img, name)
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:duration=1`, '-frames:v', '1', '-vf', `drawbox=color=${color}@0.4:t=fill`, out], { stdio: 'ignore' })
  return out
}
const square = pic('square.jpg', 1000, 1000, 'blue')
const wide = pic('wide.jpg', 3000, 300, 'red')
const tall = pic('tall.jpg', 300, 1600, 'green')
const tiny = pic('tiny.jpg', 60, 60, 'yellow')
const mk = (dir, name, tags, cover) => {
  const args = ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6:sample_rate=44100']
  if (cover) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic')
  args.push('-ac', '1', '-b:a', '128k', '-id3v2_version', '3')
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`)
  args.push(join(dir, name))
  execFileSync(ffmpeg, args, { stdio: 'ignore' })
}
mk(demo, '01.mp3', { title: 'Pray', artist: 'Tina Cousins', album: 'Killing Time', album_artist: 'Tina Cousins', date: '1998', genre: 'Dance', publisher: 'Jive', TKEY: '8A', TBPM: '128', track: '3/12', comment: 'Peak time' }, square)
mk(demo, '02.mp3', { title: 'Strings of Life', artist: 'Rhythim Is Rhythim', album: 'Innovator', date: '1987', genre: 'Techno', publisher: 'Transmat', TKEY: '11B', TBPM: '122', track: '1/10' }, square)
const LONG_COMMENT = 'Bought at Hard Wax Berlin, 2nd pressing. Plays slightly fast on the second deck, check pitch before the drop. Used in the closing set at Tresor 14/06/2025 after the Jeff Mills tool. Source https://www.discogs.com/release/1234567-Rhythim-Is-Rhythim-Strings-Of-Life-Derrick-May-Carl-Craig-Re-Edit-Extended-Unreleased-Dub-Version-Remastered-2026'
mk(ed, '01.mp3', {
  title: 'Strings of Life (Derrick May & Carl Craig Re-Edit - Extended Unreleased Dub Version) [Remastered 2026]',
  artist: 'Rhythim Is Rhythim feat. Kenny Larkin, Juan Atkins, Kevin Saunderson & Blake Baxter',
  album_artist: 'Various Artists',
  album: 'The Complete Detroit Techno Collection Vol. 1–12 (Deluxe 30th Anniversary Edition Box Set)',
  date: '2026-11-22', genre: 'Techno; Detroit Techno; Electro; Minimal; Deep House; Acid',
  grouping: 'Closing / Peak time / Warm-up / After hours',
  publisher: 'Transmat / Planet E Communications / Underground Resistance Distribution',
  composer: 'Derrick May, Carl Craig, Kenny Larkin, Juan Atkins, Kevin Saunderson, Blake Baxter',
  copyright: '℗ 2026 Transmat Records under exclusive license to Planet E Communications Inc.',
  TSRC: 'USTM12600001', TBPM: '174.9899', TKEY: 'Ab minor / G# minor', track: '103/250', disc: '12/12',
  comment: LONG_COMMENT,
}, wide)
mk(ed, '02.mp3', { title: 'U', artist: 'Jo', date: '2026-11', track: '1/1', TBPM: '0' })
mk(ed, '03.mp3', {
  title: '夜明けのダンスフロアで踊り続ける私たちの永遠のメロディー（エクステンデッド・ミックス）',
  artist: '坂本龍一・細野晴臣・高橋幸宏', album: '浮気なぼくら（リマスター２０２６・デラックス・エディション）',
  genre: 'テクノポップ', publisher: 'アルファレコード', comment: 'ライブ録音、２０２６年１１月', TKEY: 'C# minor', TBPM: '120',
}, tiny)
mk(ed, '04.mp3', {
  title: 'ليلة في القاهرة (ريمكس ممتد)', artist: 'عمرو دياب وفرقة القاهرة الموسيقية', album: 'ألبوم القاهرة الكامل (نسخة موسعة)',
  genre: 'شعبي', publisher: 'روتانا للصوتيات والمرئيات', comment: 'تسجيل حي من حفلة القاهرة 2026 (النسخة الكاملة)', TKEY: '11B', TBPM: '98',
}, tall)
mk(ed, '05.mp3', {
  title: 'Đêm Trắng Sài Gòn (Ngọc Hân Rework)', artist: 'Đặng Thị Ngọc Hân', album: 'Những Bản Tình Ca Bất Hủ',
  genre: 'V-Pop', publisher: 'Phương Nam Phim', comment: 'Ặ Ẫ Ỡ Ỹ ặ ẫ ỡ ỹ — bản phối mới', TKEY: '3A', TBPM: '124',
}, square)
mk(ed, '06.mp3', {
  title: '🔥 Fuego 🔥 (VIP Mix)', artist: '👩🏽‍💻 DJ Priya', album: '<b>Bass</b> &amp; **Drop**', genre: 'Drum & Bass',
  comment: 'Line one\nLine two\nLine three: cue at 1:32, loop the break', TKEY: '5A', TBPM: '87.5',
  publisher: 'Hospital Records', TSRC: 'GB-HSP-26-00001',
})
mk(ed, '07.mp3', { title: '   ', artist: '   ', album: '   ', comment: '   ' })
console.log('ok')
