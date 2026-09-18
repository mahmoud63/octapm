// Serves the exported web build (dist/) for end-to-end checks and demos.
// Single-page fallback: any path without a file extension gets index.html,
// which is what expo-router's `web.output: "single"` expects.
//   node scripts/serve-web.mjs [port]   (default 8081)
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const port = Number(process.argv[2] ?? process.env.PORT ?? 8081)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

if (!existsSync(path.join(root, 'index.html'))) {
  console.error(`No web export at ${root}. Run: npm run export:web`)
  process.exit(1)
}

http
  .createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    let file = path.join(root, requested)
    if (!file.startsWith(root)) {
      response.writeHead(403).end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html')
    const type = types[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    response.writeHead(200, { 'content-type': type, 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' })
    createReadStream(file).pipe(response)
  })
  .listen(port, () => console.log(`OctaPM web export on http://localhost:${port} (from ${root})`))
