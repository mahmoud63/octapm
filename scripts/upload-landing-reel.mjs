#!/usr/bin/env node
/**
 * Put the landing hero reel into object storage.
 *
 * The films are large and they are not code, so they are kept out of the
 * repository and served from a bucket. This uploads whatever is in
 * frontend/public/media to any S3-compatible store — Amazon S3, Cloudflare R2,
 * Backblaze B2, DigitalOcean Spaces, MinIO — and prints the one line of
 * configuration the front end needs afterwards.
 *
 * It reads the credentials from the environment and never writes them
 * anywhere. Nothing is sent until you pass --yes; without it the run only
 * reports what it would upload.
 *
 *   REEL_S3_ENDPOINT   https://s3.eu-west-1.amazonaws.com
 *                      https://<account>.r2.cloudflarestorage.com
 *   REEL_S3_BUCKET     octapm-web-media
 *   REEL_S3_REGION     eu-west-1            (R2 and MinIO: auto)
 *   REEL_S3_KEY        the access key id
 *   REEL_S3_SECRET     the secret access key
 *   REEL_S3_PREFIX     media                (optional, this is the default)
 *   REEL_PUBLIC_BASE   https://media.example.com
 *                      (optional: the address the public reaches the bucket by,
 *                       when it is not the endpoint itself)
 *
 *   node scripts/upload-landing-reel.mjs            # report only
 *   node scripts/upload-landing-reel.mjs --yes      # upload
 */
import { createHash, createHmac } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MEDIA = path.join(HERE, '..', 'frontend', 'public', 'media')

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim()
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => createHmac('sha256', key).update(value).digest()

/** Every path segment is escaped, but the separators stay separators. */
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/')

function sign({ method, url, region, key, secret, payloadHash, contentType, cacheControl }) {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType,
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const ordered = Object.keys(headers).sort()
  const canonicalHeaders = ordered.map((name) => `${name}:${headers[name]}\n`).join('')
  const signedHeaders = ordered.join(';')
  const canonicalRequest = [
    method,
    encodeKey(url.pathname),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = ['s3', 'aws4_request'].reduce(
    (acc, part) => hmac(acc, part),
    hmac(hmac(`AWS4${secret}`, dateStamp), region)
  )
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

const TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png' }
const CACHE = 'public, max-age=31536000, immutable'

async function main() {
  const go = process.argv.includes('--yes')
  const endpoint = env('REEL_S3_ENDPOINT')
  const bucket = env('REEL_S3_BUCKET')
  const region = env('REEL_S3_REGION', 'auto')
  const key = env('REEL_S3_KEY')
  const secret = env('REEL_S3_SECRET')
  const prefix = env('REEL_S3_PREFIX', 'media').replace(/^\/+|\/+$/g, '')

  let films
  try {
    films = (await readdir(MEDIA)).filter((name) => TYPES[path.extname(name).toLowerCase()])
  } catch {
    console.error(`No media directory at ${MEDIA}. Nothing to upload.`)
    process.exitCode = 1
    return
  }
  if (!films.length) {
    console.error(`No films in ${MEDIA}. Nothing to upload.`)
    process.exitCode = 1
    return
  }
  films.sort()

  let total = 0
  for (const film of films) {
    const size = (await stat(path.join(MEDIA, film))).size
    total += size
    console.log(`  ${film.padEnd(34)} ${String(Math.round(size / 1024)).padStart(6)} KB`)
  }
  console.log(`${films.length} files, ${(total / 1024 / 1024).toFixed(1)} MB\n`)

  const missing = [
    ['REEL_S3_ENDPOINT', endpoint],
    ['REEL_S3_BUCKET', bucket],
    ['REEL_S3_KEY', key],
    ['REEL_S3_SECRET', secret],
  ].filter(([, value]) => !value)
  if (missing.length) {
    console.error(`Set ${missing.map(([name]) => name).join(', ')} and run again.`)
    process.exitCode = 1
    return
  }

  const root = new URL(endpoint)
  // Amazon wants the bucket in the host; the others take it as the first path segment.
  const amazon = /(^|\.)amazonaws\.com$/i.test(root.host)
  const publicBase =
    env('REEL_PUBLIC_BASE') ||
    (amazon
      ? `${root.protocol}//${bucket}.${root.host}/${prefix}`
      : `${root.protocol}//${root.host}/${bucket}/${prefix}`)

  if (!go) {
    console.log('Nothing was sent. Add --yes to upload.')
    console.log(`Afterwards, set in the front end's environment:\n`)
    console.log(`  VITE_LANDING_VIDEO_BASE=${publicBase.replace(/\/[^/]*$/, '')}`)
    return
  }

  for (const film of films) {
    const body = await readFile(path.join(MEDIA, film))
    const objectKey = prefix ? `${prefix}/${film}` : film
    const url = new URL(
      amazon
        ? `${root.protocol}//${bucket}.${root.host}/${encodeKey(objectKey)}`
        : `${root.protocol}//${root.host}/${bucket}/${encodeKey(objectKey)}`
    )
    const contentType = TYPES[path.extname(film).toLowerCase()]
    const headers = sign({
      method: 'PUT',
      url,
      region,
      key,
      secret,
      payloadHash: sha256(body),
      contentType,
      cacheControl: CACHE,
    })
    const response = await fetch(url, { method: 'PUT', headers, body })
    if (!response.ok) {
      console.error(`FAILED ${film}: ${response.status} ${response.statusText}`)
      console.error((await response.text()).slice(0, 400))
      process.exitCode = 1
      return
    }
    console.log(`  uploaded ${film}`)
  }

  console.log(`\nDone. Set in the front end's environment:\n`)
  console.log(`  VITE_LANDING_VIDEO_BASE=${publicBase.replace(/\/[^/]*$/, '')}`)
  console.log(`\nThe bucket must allow public reads on ${prefix}/, or sit behind a CDN that does.`)
}

await main()
