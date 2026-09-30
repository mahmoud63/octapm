// Preloaded (node --import) before every STATIC source check by
// run-source-checks.mjs. The runner already starts the check under the Node
// permission model (read-only repository access, no child processes, no
// workers, no file writes); this closes the network, which Node 24's
// permission model does not: TCP and pipes, UDP, DNS and the fetch-family
// globals. A check that trips it is not static: register it as runtime.
// source-checks-static-guard.test.mjs proves each entry point below is denied.
import dgram from 'node:dgram'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'

const deny = (what) =>
  function denied() {
    throw new Error(
      `static source check attempted ${what}; a static check reads repository files only. Register it under "runtime" in scripts/source-checks.registry.json.`
    )
  }

// Replace every own function of `object` that `isNetwork` names. Accessors
// are left alone (reading some of them warns).
const denyFunctions = (object, isNetwork, what) => {
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(object)
  ))
    if (typeof descriptor.value === 'function' && isNetwork(name))
      object[name] = deny(`${what} (${name})`)
}

globalThis.fetch = deny('network access (fetch)')
globalThis.WebSocket = deny('network access (WebSocket)')
globalThis.EventSource = deny('network access (EventSource)')

// TCP and pipes. Every client (net, tls, http, https, http2) connects through
// Socket.prototype.connect and every server listens through
// Server.prototype.listen.
net.Socket.prototype.connect = deny('network access (socket connect)')
net.Server.prototype.listen = deny('to listen on a network port')

// UDP: the factory, and a socket constructed directly.
dgram.createSocket = deny('network access (UDP socket)')
denyFunctions(
  dgram.Socket.prototype,
  (name) => /^(bind|connect|send|add)/.test(name),
  'network access (UDP socket)'
)

// DNS: everything except local resolver configuration, on the callback API,
// the promise API and both Resolver classes.
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
for (const surface of [
  dns,
  dns.promises,
  dns.Resolver.prototype,
  dns.promises.Resolver.prototype,
])
  denyFunctions(surface, (name) => !DNS_LOCAL.has(name), 'a DNS query')

// A named ESM export of a built-in (`import { lookup } from 'node:dns'`) is a
// copy taken when the module was first loaded. Bring the copies in line with
// the replacements above.
syncBuiltinESMExports()
