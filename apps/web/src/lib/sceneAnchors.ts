import type { SectionLocation } from './analytics'

export const SCENE_ANCHORS = {
  tag: 'etiquetar',
  quality: 'calidad',
  batch: 'exportar',
  replace: 'sustituir',
  sync: 'sincronizar',
  cues: 'cues',
  review: 'biblioteca',
} as const

export const SECTION_VIEWS: Record<keyof typeof SCENE_ANCHORS, SectionLocation> = {
  quality: 'home-quality',
  tag: 'home-tag',
  batch: 'home-export',
  cues: 'home-cues',
  replace: 'home-replace',
  sync: 'home-sync',
  review: 'home-review',
}

export const HERO_ANCHORS = [
  { key: 'quality', target: SCENE_ANCHORS.quality },
  { key: 'tag', target: SCENE_ANCHORS.tag },
  { key: 'export', target: SCENE_ANCHORS.batch },
] as const
