import { apiClient } from '@/services/api/client'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * PDF.js loader for the drawings tool. The library (and its worker) load as
 * their own chunk the first time a sheet is rendered; documents are fetched
 * through the API client (bearer auth) and cached so a 100-sheet set PDF is
 * downloaded once and shared by every thumbnail and the viewer.
 */

type PdfjsModule = typeof import('pdfjs-dist')

const MAX_CACHED_DOCUMENTS = 6

let pdfjsPromise: Promise<PdfjsModule> | null = null
const documentCache = new Map<string, Promise<PDFDocumentProxy>>()

export const getPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
  }
  return pdfjsPromise
}

/** API path (as served in `fileUrl`) → request path for the axios client. */
const toApiPath = (fileUrl: string) => fileUrl.replace(/^\/api\/v1/, '')

// The v6 typings omit `destroy`, which still releases the worker's memory.
const destroyDocument = (document: PDFDocumentProxy) =>
  (document as unknown as { destroy?: () => Promise<void> }).destroy?.()

const evictOldest = () => {
  while (documentCache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = documentCache.keys().next().value
    if (!oldest) return
    const pending = documentCache.get(oldest)
    documentCache.delete(oldest)
    pending?.then(destroyDocument).catch(() => {})
  }
}

/**
 * Bytes for a sheet file: the offline cache when the device has no signal
 * (or the network fails), the API otherwise. Files fetched online are kept
 * by the service worker, so a sheet opened once stays available.
 */
const fetchSheetBytes = async (fileUrl: string): Promise<ArrayBuffer> => {
  const { readCachedFile } = await import('./offline-sheets')
  const fromCache = async () => {
    const hit = await readCachedFile(fileUrl)
    return hit ? hit.arrayBuffer() : null
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const cached = await fromCache()
    if (cached) return cached
  }
  try {
    const response = await apiClient.get<ArrayBuffer>(toApiPath(fileUrl), {
      responseType: 'arraybuffer',
      timeout: 5 * 60 * 1000,
      // In the cloud the API answers with a 302 to a presigned S3 URL. A
      // credentialed request that follows a cross-origin redirect arrives with
      // Origin: null, which no S3 CORS rule can accept alongside credentials,
      // so every sheet would fail. The bearer header still authenticates the
      // API hop; the S3 hop needs no cookie, its signature is in the URL.
      withCredentials: false,
    })
    return response.data
  } catch (error) {
    const cached = await fromCache()
    if (cached) return cached
    throw error
  }
}

export const loadSheetDocument = (fileUrl: string) => {
  const cached = documentCache.get(fileUrl)
  if (cached) return cached
  const promise = (async () => {
    const [pdfjs, bytes] = await Promise.all([
      getPdfjs(),
      fetchSheetBytes(fileUrl),
    ])
    // PDF.js transfers the buffer to its worker, so hand it a copy.
    const data = new Uint8Array(bytes.slice(0))
    return pdfjs.getDocument({ data }).promise
  })()
  promise.catch(() => documentCache.delete(fileUrl))
  documentCache.set(fileUrl, promise)
  evictOldest()
  return promise
}

export const forgetSheetDocument = (fileUrl: string) => {
  const pending = documentCache.get(fileUrl)
  documentCache.delete(fileUrl)
  pending?.then(destroyDocument).catch(() => {})
}

export interface RenderOptions {
  fileUrl: string
  pageNumber: number
  canvas: HTMLCanvasElement
  /** Target CSS width in pixels; the canvas is rendered at device pixel ratio. */
  width: number
  rotation?: number
  signal?: AbortSignal
}

/**
 * Renders one page into the canvas at the requested CSS width. Returns the
 * page's CSS size so callers can size their containers.
 */
export const renderSheetPage = async ({
  fileUrl,
  pageNumber,
  canvas,
  width,
  rotation = 0,
  signal,
}: RenderOptions) => {
  const document = await loadSheetDocument(fileUrl)
  if (signal?.aborted) return null
  const page = await document.getPage(
    Math.min(Math.max(pageNumber, 1), document.numPages)
  )
  if (signal?.aborted) return null
  const base = page.getViewport({ scale: 1, rotation })
  const scale = width / base.width
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  const viewport = page.getViewport({ scale: scale * ratio, rotation })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  canvas.style.width = `${Math.round(viewport.width / ratio)}px`
  canvas.style.height = `${Math.round(viewport.height / ratio)}px`
  const context = canvas.getContext('2d')
  if (!context) return null
  const task = page.render({ canvasContext: context, viewport, canvas })
  const abort = () => task.cancel()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await task.promise
  } catch (error) {
    if ((error as { name?: string })?.name === 'RenderingCancelledException') {
      return null
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  return {
    width: viewport.width / ratio,
    height: viewport.height / ratio,
    pageCount: document.numPages,
  }
}
