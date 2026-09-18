import { classify } from './useLayout'

describe('width classes', () => {
  it('keys on width, never on a device name', () => {
    expect(classify(360)).toBe('compact') // small Android phone
    expect(classify(430)).toBe('compact') // large iPhone
    expect(classify(599)).toBe('compact')
    expect(classify(600)).toBe('medium') // small tablet, phone in landscape
    expect(classify(820)).toBe('medium') // iPad portrait in split view
    expect(classify(899)).toBe('medium')
    expect(classify(900)).toBe('expanded')
    expect(classify(1024)).toBe('expanded') // iPad portrait
    expect(classify(1366)).toBe('expanded') // iPad landscape
  })
})
