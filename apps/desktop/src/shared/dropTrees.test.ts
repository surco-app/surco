import { describe, expect, it } from 'vitest'
import { predictTrees, trainTrees } from './dropTrees'

const rows = Array.from({ length: 400 }, (_, i) => [i / 400, (i * 7) % 13])
const labels = rows.map(([x]) => (x >= 0.5 ? 1 : 0))

describe('trainTrees', () => {
  it('learns the side of a threshold so the detector can learn what a drop looks like', () => {
    const model = trainTrees(rows, labels, { trees: 20, depth: 2, minLeaf: 10 })
    expect(predictTrees(model, [0.9, 3])).toBeGreaterThan(0)
    expect(predictTrees(model, [0.1, 3])).toBeLessThan(0)
  })

  it('trains the same model twice so the shipped one can be rebuilt', () => {
    const options = { trees: 5, depth: 2, minLeaf: 10 }
    expect(trainTrees(rows, labels, options)).toEqual(trainTrees(rows, labels, options))
  })
})
