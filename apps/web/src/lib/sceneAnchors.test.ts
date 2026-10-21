import { describe, expect, it } from 'vitest'
import { SCENE_ANCHORS } from './sceneAnchors'

const OTHER_HOME_IDS = ['top', 'main', 'como', 'mobile-nav']

describe('scene anchors', () => {
  const ids = Object.values(SCENE_ANCHORS)

  it('gives every example its own id, since the browser scrolls a shared link to the first match', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never reuses an id the rest of the home already takes, or the link lands on the wrong block', () => {
    expect(ids.filter((id) => OTHER_HOME_IDS.includes(id))).toEqual([])
  })

  it('uses ids that survive being typed or pasted into a URL fragment unescaped', () => {
    expect(ids.filter((id) => !/^[a-z0-9-]+$/.test(id))).toEqual([])
  })
})
