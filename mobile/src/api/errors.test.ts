import { AppError, fromNetwork, fromStatus, looksTechnical, userMessage } from './errors'

describe('errors shown to a person', () => {
  it('maps status codes to the mobile error model', () => {
    expect(fromStatus(401, undefined).code).toBe('AUTH_REQUIRED')
    expect(fromStatus(403, undefined).code).toBe('FORBIDDEN')
    expect(fromStatus(404, undefined).code).toBe('NOT_FOUND')
    expect(fromStatus(409, undefined).code).toBe('CONFLICT')
    expect(fromStatus(422, undefined).code).toBe('VALIDATION')
    expect(fromStatus(429, undefined).code).toBe('RATE_LIMITED')
    expect(fromStatus(503, undefined).code).toBe('SERVER_ERROR')
  })

  it('never shows a stack, an identifier or a library name', () => {
    const ugly = fromStatus(500, { code: 'PRISMA_P2002', message: 'Invalid `prisma.user.findUnique()` invocation at line 316' })
    expect(ugly.userMessage).not.toMatch(/prisma|invocation/i)
    const withId = fromStatus(400, { message: 'Record 00ee4560-7d45-4fe3-8f68-f4ba8386be97 is invalid' })
    expect(withId.userMessage).not.toMatch(/[0-9a-f]{8}-/)
    expect(looksTechnical('TypeError: cannot read undefined')).toBe(true)
    expect(looksTechnical('The due date must be after the start date')).toBe(false)
  })

  it('passes a plain validation message through', () => {
    const plain = fromStatus(400, { code: 'VALIDATION', message: 'Subject is required' })
    expect(plain.userMessage).toBe('Subject is required')
  })

  it('keeps the server code and request id for support without showing them', () => {
    const error = fromStatus(500, { code: 'LEDGER_POST_FAILED', message: 'boom', requestId: 'req-8f2a' })
    expect(error.serverCode).toBe('LEDGER_POST_FAILED')
    expect(error.requestId).toBe('req-8f2a')
    expect(error.reference).toBe('SERVER_ERROR · ref req-8f2a')
    expect(error.userMessage).not.toMatch(/req-8f2a|LEDGER/)
    expect(fromStatus(500, undefined, 'hdr-1').requestId).toBe('hdr-1')
  })

  it('knows which failures are worth retrying', () => {
    expect(fromNetwork(new TypeError('Failed to fetch')).code).toBe('OFFLINE')
    expect(fromNetwork(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })).code).toBe('TIMEOUT')
    expect(fromNetwork(new TypeError('Failed to fetch')).retryable).toBe(true)
    expect(fromStatus(403, undefined).retryable).toBe(false)
    expect(fromStatus(500, undefined).retryable).toBe(true)
  })

  it('has a sentence for anything thrown', () => {
    expect(userMessage(new AppError('CONFLICT'))).toMatch(/somebody else changed/i)
    expect(userMessage('nonsense')).toMatch(/try again/i)
  })
})
