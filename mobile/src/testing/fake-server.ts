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

export function fakeServer(routes: Record<string, Route>): Call[] {
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
    const body = raw ? JSON.parse(raw) : undefined
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })
    const call: Call = { method: request.method, path, headers, body, query }
    calls.push(call)
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
