import { fitRect, mapStrokesToImage, markedName, strokeWidthOnImage } from './annotate'

describe('photo markup maths', () => {
  it('fits a landscape and a portrait photo inside the view, centred', () => {
    expect(fitRect({ width: 4000, height: 3000 }, { width: 400, height: 400 })).toEqual({ x: 0, y: 50, width: 400, height: 300 })
    expect(fitRect({ width: 3000, height: 4000 }, { width: 400, height: 400 })).toEqual({ x: 50, y: 0, width: 300, height: 400 })
    expect(fitRect({ width: 0, height: 0 }, { width: 400, height: 400 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('maps screen strokes onto the photo’s own pixels and clamps to its edges', () => {
    const image = { width: 4000, height: 3000 }
    const view = { width: 400, height: 400 }
    // The photo occupies y 50..350 on screen at scale 10.
    expect(mapStrokesToImage([[{ x: 0, y: 50 }, { x: 200, y: 200 }, { x: 400, y: 350 }]], image, view)).toEqual([[{ x: 0, y: 0 }, { x: 2000, y: 1500 }, { x: 4000, y: 3000 }]])
    // A point in the letterbox band lands on the edge, not outside the photo.
    expect(mapStrokesToImage([[{ x: 100, y: 10 }]], image, view)).toEqual([[{ x: 1000, y: 0 }]])
    expect(mapStrokesToImage([[{ x: 1, y: 1 }]], { width: 0, height: 0 }, view)).toEqual([])
  })

  it('scales the stroke width with the photo and names the marked copy', () => {
    expect(strokeWidthOnImage(4, { width: 4000, height: 3000 }, { width: 400, height: 400 })).toBe(40)
    expect(markedName('IMG_0042.HEIC')).toBe('IMG_0042-marked.jpg')
    expect(markedName('photo-1.jpg')).toBe('photo-1-marked.jpg')
    expect(markedName('.jpg')).toBe('photo-marked.jpg')
  })
})
