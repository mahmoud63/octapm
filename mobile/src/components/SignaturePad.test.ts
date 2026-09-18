import { rasterise, strokePoints } from '@/components/SignaturePad'

describe('the signature pad', () => {
  it('turns a stroke into the points a polyline draws', () => {
    expect(strokePoints([{ x: 10, y: 20.25 }, { x: 11.5, y: 21 }])).toBe('10.0,20.3 11.5,21.0')
    expect(strokePoints([])).toBe('')
  })

  it('on a device hands the drawing to the view capture and returns what it gives', async () => {
    const capture = jest.fn(async () => 'data:image/png;base64,iVBORw0KGgo=')
    await expect(rasterise([[{ x: 1, y: 1 }]], { width: 300, height: 120 }, capture)).resolves.toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(capture).toHaveBeenCalledTimes(1)
    await expect(rasterise([], { width: 300, height: 120 })).rejects.toThrow(/No capture/)
  })
})
