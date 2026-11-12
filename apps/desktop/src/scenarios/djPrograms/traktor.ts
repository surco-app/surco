import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toNmlLocation } from '../../main/ffmpeg'
import { bootVolumeName } from '../../main/traktorNmlLibrary'
import type { TestLibrary } from './testLibrary'

const attr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function location(path: string): { volume: string; dir: string; file: string } {
  const { volume, dir, file } = toNmlLocation(path.normalize('NFC'))
  return { volume: volume || bootVolumeName(), dir, file }
}

export const traktorLibrary: TestLibrary = {
  build: ({ root }, tracks, listName) => {
    const entries = tracks.map((t, i) => {
      const { volume, dir, file } = location(t.path)
      return `<ENTRY MODIFIED_DATE="2026/11/11" AUDIO_ID="AQAAAAAAAAAAAAAAAAAAAA${String(i).padStart(4, '0')}" TITLE="${attr(t.title)}" ARTIST="${attr(t.artist)}"><LOCATION DIR="${attr(dir)}" FILE="${attr(file)}" VOLUME="${attr(volume)}" VOLUMEID="${attr(volume || 'boot')}"></LOCATION>
<INFO PLAYTIME="${t.durationSec}"></INFO>
<TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO>
</ENTRY>`
    })
    const keys = tracks.map((t) => {
      const { volume, dir, file } = location(t.path)
      return `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${attr(`${volume}${dir}${file}`)}"></PRIMARYKEY>\n</ENTRY>`
    })
    const nml = join(root, 'Traktor', 'collection.nml')
    mkdirSync(join(root, 'Traktor'), { recursive: true })
    writeFileSync(
      nml,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="${entries.length}">
${entries.join('\n')}
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">
<NODE TYPE="PLAYLIST" NAME="${attr(listName)}"><PLAYLIST ENTRIES="${keys.length}" TYPE="LIST" UUID="battery-list">
${keys.join('\n')}
</PLAYLIST>
</NODE>
</SUBNODES>
</NODE>
</PLAYLISTS>
</NML>
`,
    )
    return { syncTraktor: true, addToTraktor: true, traktorNmlPath: nml, traktorCueOffsetMs: 0 }
  },
  formatProblems: () => [],
  storedCuesMs: ({ traktorNmlPath }, path) => {
    const { dir, file } = location(path)
    const nml = readFileSync(traktorNmlPath ?? '', 'utf8')
    const entry = [...nml.matchAll(/<ENTRY [^>]*>[\s\S]*?<\/ENTRY>/g)]
      .map(([block]) => block)
      .find((block) => block.includes(`DIR="${attr(dir)}" FILE="${attr(file)}"`))
    return [...(entry ?? '').matchAll(/<CUE_V2 [^>]*>/g)]
      .map(([cue]) => cue)
      .filter((cue) => Number(cue.match(/ HOTCUE="(-?\d+)"/)?.[1] ?? -1) >= 0)
      .map((cue) => Number(cue.match(/ START="([^"]*)"/)?.[1]))
  },
}
