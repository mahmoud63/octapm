// R5-6: "static" is enforced, not only declared. Under the runner a static
// check has no network (TCP, UDP, DNS, fetch), and the Node permission model
// gives it read-only access to the repository and nothing else. Run alone
// (npm run test:source-guard) this loads the guard itself and proves the
// network half; under the runner it proves that the runner preloaded the
// guard, and the runner's own flags.
//
// Every call below must throw before any I/O starts, with the guard's message
// for that kind of access (so one denial cannot stand in for another). The
// targets are a reserved .invalid name, the loopback discard port and an
// ephemeral port, so a broken guard fails this check without reaching anything
// real.
import assert from 'node:assert/strict'
import { parse } from 'node:path'
import { fileURLToPath } from 'node:url'

// Under the runner the guard is already loaded (node --import). Loading it
// here as well would hide a runner that stopped preloading it.
const underRunner = process.env.OCTAPM_SOURCE_CHECK === 'static'
if (!underRunner) await import('./source-checks-static-guard.mjs')

const DENIED = 'static source check attempted '
const FETCH = 'network access (fetch)'
const CONNECT = 'network access (socket connect)'
const LISTEN = 'to listen on a network port'
const UDP = 'network access (UDP socket)'
const DNS = 'a DNS query'
const HOST = 'octapm-static-guard.invalid'
const LOOPBACK = '127.0.0.1'
const DISCARD = 9

let proven = 0
const denied = (label, what, attempt) => {
  assert.throws(
    attempt,
    (error) =>
      error instanceof Error && error.message.startsWith(DENIED + what),
    `${label} is reachable from a static check (expected "${DENIED}${what}")`
  )
  proven += 1
}
// Own function-valued properties, without touching accessors.
const functionNames = (object) =>
  Object.entries(Object.getOwnPropertyDescriptors(object))
    .filter(([, descriptor]) => typeof descriptor.value === 'function')
    .map(([name]) => name)

// Globals.
denied('fetch', FETCH, () => fetch(`http://${LOOPBACK}:${DISCARD}/`))
denied(
  'WebSocket',
  'network access (WebSocket)',
  () => new WebSocket(`ws://${LOOPBACK}:${DISCARD}/`)
)
denied(
  'EventSource',
  'network access (EventSource)',
  () => new EventSource(`http://${LOOPBACK}:${DISCARD}/`)
)

// TCP: clients and servers, through the default export and the named exports
// (a named ESM export of a built-in is a copy, so both are checked).
const net = await import('node:net')
denied('net.connect', CONNECT, () => net.default.connect(DISCARD, LOOPBACK))
denied('net { connect }', CONNECT, () => net.connect(DISCARD, LOOPBACK))
denied('net { createConnection }', CONNECT, () =>
  net.createConnection(DISCARD, LOOPBACK)
)
denied('new net.Socket().connect', CONNECT, () =>
  new net.Socket().connect(DISCARD, LOOPBACK)
)
denied('net server listen', LISTEN, () => net.createServer().listen(0))
const tls = await import('node:tls')
denied('tls.connect', CONNECT, () => tls.connect(DISCARD, LOOPBACK))
const http = await import('node:http')
denied('http.get', CONNECT, () => http.get(`http://${LOOPBACK}:${DISCARD}/`))
denied('http server listen', LISTEN, () => http.createServer().listen(0))
const https = await import('node:https')
denied('https.get', CONNECT, () => https.get(`https://${LOOPBACK}:${DISCARD}/`))

// UDP: the factory and a socket constructed directly.
const dgram = await import('node:dgram')
denied('dgram.createSocket', UDP, () => dgram.default.createSocket('udp4'))
denied('dgram { createSocket }', UDP, () => dgram.createSocket('udp4'))
const udpMethods = functionNames(dgram.Socket.prototype).filter((name) =>
  /^(bind|connect|send|add)/.test(name)
)
for (const name of ['bind', 'connect', 'send', 'addMembership'])
  assert.ok(udpMethods.includes(name), `dgram.Socket has no ${name}?`)
const udp = new dgram.Socket('udp4')
try {
  for (const name of udpMethods)
    denied(`new dgram.Socket().${name}`, `${UDP} (${name})`, () =>
      udp[name]('x', DISCARD, LOOPBACK)
    )
} finally {
  udp.close()
}

// DNS: every function that is not local resolver configuration, on every
// surface a check can reach it from.
const DNS_LOCAL = new Set([
  'Resolver',
  'constructor',
  'cancel',
  'getServers',
  'setServers',
  'setLocalAddress',
  'getDefaultResultOrder',
  'setDefaultResultOrder',
])
const dns = await import('node:dns')
const dnsPromises = await import('node:dns/promises')
const dnsSurfaces = {
  dns: [
    dns.default,
    ['lookup', 'lookupService', 'resolve', 'resolve4', 'reverse'],
  ],
  'dns { named }': [dns, ['lookup', 'resolve4']],
  'dns.promises': [dns.default.promises, ['lookup', 'resolve4', 'reverse']],
  'dns/promises { named }': [dnsPromises, ['lookup', 'resolve4']],
  'dns.Resolver.prototype': [
    dns.Resolver.prototype,
    ['resolve', 'resolve4', 'reverse'],
  ],
  'dns.promises.Resolver.prototype': [
    dnsPromises.Resolver.prototype,
    ['resolve', 'resolve4', 'reverse'],
  ],
}
for (const [label, [surface, expected]] of Object.entries(dnsSurfaces)) {
  const names = functionNames(surface).filter((name) => !DNS_LOCAL.has(name))
  for (const name of expected)
    assert.ok(names.includes(name), `${label} has no ${name}?`)
  for (const name of names)
    denied(`${label}.${name}`, `${DNS} (${name})`, () =>
      surface[name](HOST, () => {})
    )
}
denied('new dns.Resolver().resolve4', DNS, () =>
  new dns.Resolver().resolve4(HOST, () => {})
)
denied('new dns.promises.Resolver().resolve4', DNS, () =>
  new dnsPromises.Resolver().resolve4(HOST)
)

// The runner's own flags: read-only repository access, no child process, no
// worker, no write, and no credentials from the parent shell.
if (underRunner) {
  assert.ok(
    process.permission,
    'the runner starts a static check under the Node permission model'
  )
  for (const scope of ['fs.write', 'child', 'worker'])
    assert.equal(
      process.permission.has(scope),
      false,
      `a static check has the "${scope}" permission`
    )
  const here = fileURLToPath(import.meta.url)
  assert.equal(
    process.permission.has('fs.read', here),
    true,
    'a static check can read the repository'
  )
  assert.equal(
    process.permission.has('fs.read', parse(here).root),
    false,
    'a static check can read outside the repository'
  )
  assert.throws(
    () => process.getBuiltinModule('node:child_process').execSync('node -v'),
    { code: 'ERR_ACCESS_DENIED' },
    'a static check can start a child process'
  )
  assert.deepEqual(
    Object.keys(process.env).filter((key) =>
      /DATABASE|SECRET|TOKEN|PASSWORD/i.test(key)
    ),
    [],
    'credentials from the parent shell reach a static check'
  )
}

console.log(
  `source-checks-static-guard: ok (${proven} network entry points denied; ` +
    `${underRunner ? 'permission model proven' : 'run alone: permission model not checked'})`
)
