import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { caseDir, durations, FFMPEG, HERE, WORK } from './kit.mjs'

const name = process.argv[2]
const dir = caseDir(name)
const out = process.argv[3] || join(WORK, 'out', `surco-${name}.mp4`)
mkdirSync(join(WORK, 'out'), { recursive: true })
const lines = Object.fromEntries(
  JSON.parse(readFileSync(join(HERE, 'cases', name, 'lines.json'), 'utf8')).map((l) => [l.id, l]),
)
const said = durations(name)
const { t0, frames, marks, zooms = [] } = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'))
const end = marks.find((m) => m.id === 'end').t
const FPS = 30
const EASE = 0.8
const CARD = 3

const times = frames.map((f) => f.t - t0)
const seq = join(dir, 'seq')
rmSync(seq, { recursive: true, force: true })
mkdirSync(seq)
let i = 0
for (let k = 0; k <= Math.floor(end * FPS); k++) {
  while (i + 1 < times.length && times[i + 1] <= k / FPS) i++
  symlinkSync(join(dir, 'frames', frames[i].name), join(seq, `${String(k).padStart(6, '0')}.jpg`))
}

const ease = (t, from, to) => {
  const u = Math.min(Math.max((t - from.t) / EASE, 0), 1)
  const s = u * u * (3 - 2 * u)
  return { cx: from.cx + (to.cx - from.cx) * s, cy: from.cy + (to.cy - from.cy) * s, scale: from.scale + (to.scale - from.scale) * s }
}
const segments = []
let state = { cx: 720, cy: 405, scale: 1 }
for (const [n, z] of zooms.entries()) {
  if (n > 0) state = ease(z.t, { ...segments.at(-1).from, t: segments.at(-1).t }, segments.at(-1).to)
  segments.push({ t: z.t, from: state, to: z })
}
const track = (key) => {
  const rest = { scale: 1, cx: 720, cy: 405 }[key]
  if (segments.length === 0) return String(rest)
  const T = `in/${FPS}`
  const curve = (seg) => {
    const a = seg.from[key]
    const u = `clip((${T}-${seg.t.toFixed(3)})/${EASE},0,1)`
    return `${a}+(${seg.to[key] - a})*${u}*${u}*(3-2*${u})`
  }
  let expr = curve(segments.at(-1))
  for (let n = segments.length - 2; n >= 0; n--)
    expr = `if(lt(${T},${segments[n + 1].t.toFixed(3)}),${curve(segments[n])},${expr})`
  return `if(lt(${T},${segments[0].t.toFixed(3)}),${rest},${expr})`
}
const f = `(iw/1440)`
const zoompan =
  `zoompan=d=1:fps=${FPS}:s=1600x900:z='${track('scale')}'` +
  `:x='clip(${track('cx')}*${f}-iw/zoom/2,0,iw-iw/zoom)'` +
  `:y='clip(${track('cy')}*${f}-ih/zoom/2,0,ih-ih/zoom)'`

const ts = (s) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`
const speech = marks.filter((m) => lines[m.id])
const subs = join(dir, 'subs.ass')
writeFileSync(
  subs,
  [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: S,Helvetica Neue,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,80,80,38,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...speech.map((m) => `Dialogue: 0,${ts(m.t)},${ts(m.t + said[m.id] + 0.35)},S,,0,0,0,,${lines[m.id].sub}`),
    '',
  ].join('\n'),
)

const inputs = ['-framerate', String(FPS), '-i', join(seq, '%06d.jpg')]
const delays = speech.map((m, n) => {
  inputs.push('-i', join(dir, 'tts', `${m.id}.aiff`))
  const d = Math.round(m.t * 1000)
  return `[${n + 1}:a]aresample=48000,adelay=${d}|${d}[a${n}]`
})
const font = '/System/Library/Fonts/SFNS.ttf'
const graph = [
  ...delays,
  `${speech.map((_, n) => `[a${n}]`).join('')}amix=inputs=${speech.length}:normalize=0,pan=stereo|c0=c0|c1=c0,apad,atrim=0:${end + CARD},afade=t=out:st=${end + CARD - 0.8}:d=0.8[aout]`,
  `[0:v]${zoompan},setsar=1,trim=0:${end},setpts=PTS-STARTPTS[app]`,
  `color=c=0x0f1017:s=1920x1080:r=${FPS}:d=${end}[bg]`,
  `[bg][app]overlay=160:44,drawbox=x=159:y=43:w=1602:h=902:color=0x2a2d3d:t=1,subtitles=${subs}[main]`,
  `color=c=0x0f1017:s=1920x1080:r=${FPS}:d=${CARD},drawtext=fontfile=${font}:text='Surco':fontsize=120:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-50,drawtext=fontfile=${font}:text='surco.app':fontsize=44:fontcolor=0x8b93b8:x=(w-tw)/2:y=(h-th)/2+70,fade=t=in:st=0:d=0.5[card]`,
  '[main][card]concat=n=2:v=1:a=0,format=yuv420p[vout]',
].join(';')
execFileSync(FFMPEG, [
  '-v', 'error', '-y', ...inputs,
  '-filter_complex', graph,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
  out,
])
console.log(out)
