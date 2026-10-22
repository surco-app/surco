const TABLE = [
  '#305aff',
  '#5073ff',
  '#508cff',
  '#50a0ff',
  '#50b4ff',
  '#50b0f2',
  '#50aee8',
  '#45acdb',
  '#00e0ff',
  '#19daf0',
  '#32d2e6',
  '#21b4b9',
  '#20aaa0',
  '#1fa392',
  '#19a08c',
  '#14a584',
  '#14aa7d',
  '#10b176',
  '#30d26e',
  '#37de5a',
  '#3ceb50',
  '#28e214',
  '#7dc13d',
  '#8cc832',
  '#9bd723',
  '#a5e116',
  '#a5dc0a',
  '#aad208',
  '#b4c805',
  '#b4be04',
  '#bab404',
  '#c3af04',
  '#e1aa00',
  '#ffa000',
  '#ff9600',
  '#ff8c00',
  '#ff7500',
  '#e0641b',
  '#e0461e',
  '#e0301e',
  '#e02823',
  '#e62828',
  '#ff376f',
  '#ff2d6f',
  '#ff127b',
  '#f51e8c',
  '#eb2da0',
  '#e637b4',
  '#de44cf',
  '#de448d',
  '#e630b4',
  '#e619dc',
  '#e600ff',
  '#dc00ff',
  '#cc00ff',
  '#b432ff',
  '#b93cff',
  '#c542ff',
  '#aa5aff',
  '#aa72ff',
  '#8272ff',
  '#6473ff',
]

export const HOT_CUE_DEFAULT_COLOR = '#28e214'
export const MEMORY_CUE_COLOR = '#e62828'
export const PAD_LETTER_COLOR = '#ffffff'

export function hotCueColor(index: number | null): string {
  return (index !== null && index >= 1 ? TABLE[index - 1] : undefined) ?? HOT_CUE_DEFAULT_COLOR
}

export function hotCueArgb(index: number | null): number {
  return (0xff000000 | Number.parseInt(hotCueColor(index).slice(1), 16)) >>> 0
}

export function nearestHotCueColor(argb: number): number {
  const distance = (hex: string): number =>
    [16, 8, 0].reduce((sum, shift, i) => {
      const d = ((argb >>> shift) & 0xff) - Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
      return sum + d * d
    }, 0)
  let best = 0
  for (let i = 1; i < TABLE.length; i++) if (distance(TABLE[i]) < distance(TABLE[best])) best = i
  return best + 1
}

export const HOT_CUE_PICKER = [48, 52, 56, 60, 1, 5, 9, 14, 18, 22, 26, 30, 32, 38, 42, 45]
export const HOT_CUE_DEFAULT_INDEX = 22
