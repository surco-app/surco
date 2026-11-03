export const SCENE_ANCHORS = {
  tag: 'etiquetar',
  quality: 'calidad',
  batch: 'exportar',
  replace: 'sustituir',
  cues: 'cues',
  review: 'biblioteca',
} as const

export const HERO_ANCHORS = [
  { key: 'quality', target: SCENE_ANCHORS.quality },
  { key: 'tag', target: SCENE_ANCHORS.tag },
  { key: 'export', target: SCENE_ANCHORS.batch },
] as const
