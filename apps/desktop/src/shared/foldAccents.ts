const SPELLED_OUT: Record<string, string> = {
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ß: 'ss',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  ı: 'i',
}

export function foldAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/[øØæÆœŒßłŁđĐðÐþÞı]/g, (c) => SPELLED_OUT[c])
}
