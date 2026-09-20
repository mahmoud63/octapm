/**
 * A server for tests: a table of routes and a record of what was asked.
 *
 * The client builds a Request object and hands it to fetch, so the fake reads
 * method, headers and body from that object rather than from a second
 * argument. Responses carry the backend's envelope, exactly as the real one
 * does for a native client.
 */
export interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
  /** The query string, decoded. */
  query: Record<string, string>
}

export type Route = (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> }

export function fakeServer(routes: Record<string, Route>, options: { until?: Promise<unknown> } = {}): Call[] {
  const calls: Call[] = []
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const raw = await request.text()
    let body: unknown = undefined
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        // A multipart upload: keep the raw text so a test can inspect it.
        body = raw
      }
    }
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })
    const call: Call = { method: request.method, path, headers, body, query }
    calls.push(call)
    // A held server has taken the request but not yet answered it.
    if (options.until) await options.until
    const route = routes[`${request.method} ${path}`]
    if (!route) {
      return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `no route for ${request.method} ${path}` } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    const out = route(call)
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), {
      status: out.status,
      headers: { 'content-type': 'application/json', ...(out.headers ?? {}) },
    })
  }) as unknown as typeof fetch
  return calls
}

/**
 * A fake server that has received the request but has not answered yet.
 *
 * A test that asserts what the app shows *before* the server speaks cannot use
 * the ordinary fake, whose answer is already a resolved promise: whether it
 * lands before the next line depends on how many microtasks the render happens
 * to drain. That is a race, and a race fails roughly one run in five. Here the
 * request is recorded at once and the answer waits for `release()`, so "before
 * the server has spoken" is a state the test holds open rather than hopes for.
 */
export function pendingServer(routes: Record<string, Route>) {
  let release!: () => void
  const until = new Promise<void>((resolve) => {
    release = resolve
  })
  return { calls: fakeServer(routes, { until }), release }
}

/** A fetch that never reaches a server. */
export function deadNetwork(message = 'Failed to fetch') {
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError(message)
  }) as unknown as typeof fetch
}

export const envelope = <T>(data: T) => ({ success: true, data })
export const failure = (status: number, code: string, message: string, requestId?: string) => ({
  status,
  body: { success: false, error: { code, message, ...(requestId ? { requestId } : {}) } },
})
