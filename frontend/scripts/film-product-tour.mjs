/**
 * Films the landing hero's product clip from the running web app.
 *
 *   node scripts/film-product-tour.mjs <projectId> [route] [zoom] [driftPx]
 *
 *   node scripts/film-product-tour.mjs 4735659e-… schedule/activities 1.35 80
 *
 * Needs the API on :5000 and the web app on :5173 (the showcase project comes
 * from `node backend/scripts/demo/seed-showcase-project.js`). Signs in with
 * the seeded demo project manager — FILM_EMAIL / FILM_PASSWORD override — in a
 * session that is not recorded, so the film opens inside the workspace.
 *
 * What it films, and why: one screen, with the interface enlarged so the
 * figures are legible once the film is scaled into the hero frame, and the
 * only movement a slow drift down and back — so the last frame is the first
 * and the loop closes without a cut. Earlier cuts that scrolled whole pages
 * and cut between screens read as a grey blur and felt restless.
 *
 * Output: public/media/product-tour.webm (VP8 — the only format Playwright's
 * bundled ffmpeg encodes; Chrome, Edge, Firefox and Safari 16+ play it, and
 * older Safari shows the poster) and public/media/product-tour-poster.png.
 * The recording carries a settle before the first frame, so it is trimmed to
 * the filmed seconds with that same ffmpeg.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.FILM_BASE_URL ?? 'http://localhost:5173'
const EMAIL = process.env.FILM_EMAIL ?? 'pm@octapm.demo'
const PASSWORD = process.env.FILM_PASSWORD ?? 'DemoPassw0rd!'
const [PROJECT, ROUTE = 'schedule/activities', ZOOM = '1.35', DRIFT = '80'] = process.argv.slice(2)
if (!PROJECT) throw new Error('name the project id to film')

const MEDIA = new URL('../public/media/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
// Short and outside the repository: Playwright's recorder and ffmpeg both
// stumble on long Windows paths.
const WORK = join(tmpdir(), 'octapm-product-tour')
// 8:5, the frame's shape; small enough that the enlarged interface fills it.
const SIZE = { width: 1120, height: 700 }
const SECONDS = 8.1

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

const browser = await chromium.launch()

// Sign in, off camera.
const entry = await browser.newContext({ viewport: SIZE })
const door = await entry.newPage()
await door.goto(`${BASE}/sign-in`)
await door.getByPlaceholder('name@example.com').fill(EMAIL)
await door.locator('input[type="password"]').first().fill(PASSWORD)
await Promise.all([
  door.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST'),
  door.getByRole('button', { name: 'Sign in', exact: true }).click(),
])
await door.waitForTimeout(2500)
const state = await entry.storageState()
await entry.close()

const context = await browser.newContext({
  viewport: SIZE,
  storageState: state,
  recordVideo: { dir: WORK, size: SIZE },
  reducedMotion: 'no-preference',
})

// A throwaway page warms the screen; its own film is discarded, so the kept
// film opens on a page that has already settled.
const warm = await context.newPage()
await warm.goto(`${BASE}/projects/${PROJECT}/${ROUTE}`, { waitUntil: 'domcontentloaded' })
await warm.waitForTimeout(4000)
await warm.close()

const page = await context.newPage()
await page.goto(`${BASE}/projects/${PROJECT}/${ROUTE}`, { waitUntil: 'domcontentloaded' })
await page.evaluate((zoom) => {
  document.documentElement.style.zoom = String(zoom)
}, Number(ZOOM))
await page.waitForTimeout(3500)

await page.screenshot({ path: join(WORK, 'poster.png') })

/** One slow, eased drift. Nothing else moves. */
const drift = (to, ms) =>
  page.evaluate(
    ([target, duration]) =>
      new Promise((done) => {
        const start = window.scrollY
        const first = performance.now()
        const step = (now) => {
          const t = Math.min(1, (now - first) / duration)
          const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
          window.scrollTo(0, start + (target - start) * eased)
          if (t < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }),
    [to, ms]
  )

// Eight seconds: a short hold, down, a breath, back up, a hold to close the loop.
await page.waitForTimeout(1000)
await drift(Number(DRIFT), 2800)
await page.waitForTimeout(600)
await drift(0, 2800)
await page.waitForTimeout(800)

await context.close()
await browser.close()

// The kept film is the longer one; the warm-up page's is discarded.
const films = readdirSync(WORK)
  .filter((name) => name.endsWith('.webm'))
  .map((name) => ({ name, size: statSync(join(WORK, name)).size }))
  .sort((a, b) => b.size - a.size)
if (!films.length) throw new Error('the recorder wrote no film')
const raw = join(WORK, 'raw.webm')
renameSync(join(WORK, films[0].name), raw)

// Trim to the filmed seconds with the ffmpeg Playwright ships.
const ffmpeg = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
const bin = readdirSync(ffmpeg)
  .filter((name) => name.startsWith('ffmpeg-'))
  .map((name) => join(ffmpeg, name, 'ffmpeg-win64.exe'))
  .find((path) => statSync(path, { throwIfNoEntry: false }))
if (!bin) throw new Error('Playwright\'s ffmpeg was not found under ms-playwright; run `npx playwright install`')
const probe = spawnSync(bin, ['-hide_banner', '-i', raw], { encoding: 'utf8' })
const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe.stderr)
if (!match) throw new Error('could not read the recording\'s length')
const total = Number(match[2]) * 60 + Number(match[3])
const start = Math.max(0, total - SECONDS).toFixed(2)
const cut = join(WORK, 'product-tour.webm')
const encode = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-ss', start, '-i', raw, '-c:v', 'libvpx', '-b:v', '900k', '-crf', '32', '-g', '50', '-an', '-y', cut], { encoding: 'utf8' })
if (encode.status !== 0) throw new Error(`ffmpeg failed: ${encode.stderr}`)

copyFileSync(cut, join(MEDIA, 'product-tour.webm'))
copyFileSync(join(WORK, 'poster.png'), join(MEDIA, 'product-tour-poster.png'))
console.log(`film:   public/media/product-tour.webm — ${(statSync(cut).size / 1024).toFixed(0)} KB, ${SECONDS}s`)
console.log(`poster: public/media/product-tour-poster.png`)
