// Preloaded (node --import) before every STATIC source check by
// run-source-checks.mjs. The runner already starts the check under the Node
// permission model (read-only repository access, no child processes, no file
// writes); this closes the network, which Node 24's permission model does not.
// A check that trips it is not static: register it as runtime.
import dgram from 'node:dgram'
import net from 'node:net'

const deny = (what) =>
  function denied() {
    throw new Error(
      `static source check attempted ${what}; a static check reads repository files only. Register it under "runtime" in scripts/source-checks.registry.json.`
    )
  }

globalThis.fetch = deny('network access (fetch)')
globalThis.WebSocket = deny('network access (WebSocket)')
globalThis.EventSource = deny('network access (EventSource)')
net.Socket.prototype.connect = deny('network access (socket connect)')
net.Server.prototype.listen = deny('to listen on a network port')
dgram.createSocket = deny('network access (UDP socket)')
