import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { caseDir, FFMPEG, MUSIC } from '../../kit.mjs'

const dir = join(caseDir('titulos'), 'pristine')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const make = (from, title, artist, file) =>
  execFileSync(FFMPEG, [
    '-v', 'error', '-y', '-i', join(MUSIC, from),
    '-map', '0:a', '-map_metadata', '-1', '-c:a', 'flac',
    '-metadata', `title=${title}`, '-metadata', `artist=${artist}`,
    join(dir, file),
  ])
const sig = ' [www.hardpromos.net]'
make('Barthezz/On The Move/On The Move (Original Mix).wav', `On_The_Move_(Original_Mix)${sig}`, 'Barthezz', '01_barthezz-on_the_move.flac')
make('Double You/Double You/Dancing With An Angel (Angel Mix).wav', `Dancing_With_An_Angel_(Angel_Mix)${sig}`, 'Double_You', '02_double_you-dancing_with_an_angel.flac')
make('Greenfield/Violet Club Sandwich/Violet Club Sandwich (Original Mix).wav', `Violet_Club_Sandwich_(Original_Mix)${sig}`, 'Greenfield', '03_greenfield-violet_club_sandwich.flac')
make('Magic Affair/Magic Affair/Energy Of Light (Club Mix).wav', `Energy_Of_Light_(Club_Mix)${sig}`, 'Magic_Affair', '04_magic_affair-energy_of_light.flac')
make('Scott Brown/Now Is The Time/Now Is The Time.wav', `Now_Is_The_Time${sig}`, 'Scott_Brown', '05_scott_brown-now_is_the_time.flac')
