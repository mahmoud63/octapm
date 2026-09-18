/**
 * Photo markup before upload: the maths behind the sheet, kept pure so it
 * is tested without a device. The photo is shown fitted inside the markup
 * view; strokes are captured in view coordinates and mapped back onto the
 * photo's own pixels before the marked copy is produced.
 */
import { Platform } from 'react-native'
import { paintStrokes, type Stroke } from '@/components/strokes'

export interface Size {
  width: number
  height: number
}
export interface Rect extends Size {
  x: number
  y: number
}

/** Where a photo of `image` size sits when fitted (contained) inside `view`. */
export function fitRect(image: Size, view: Size): Rect {
  if (image.width <= 0 || image.height <= 0 || view.width <= 0 || view.height <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.min(view.width / image.width, view.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height }
}

/** Strokes drawn over the fitted photo, in the photo's own pixel coordinates; points outside the photo are clamped to its edge. */
export function mapStrokesToImage(strokes: Stroke[], image: Size, view: Size): Stroke[] {
  const rect = fitRect(image, view)
  if (rect.width === 0 || rect.height === 0) return []
  const scale = image.width / rect.width
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)
  return strokes.map((stroke) => stroke.map((p) => ({ x: clamp((p.x - rect.x) * scale, image.width), y: clamp((p.y - rect.y) * scale, image.height) })))
}

/** Stroke width on the photo, so the line looks the same as it did on screen. */
export const strokeWidthOnImage = (widthOnScreen: number, image: Size, view: Size) => {
  const rect = fitRect(image, view)
  return rect.width > 0 ? widthOnScreen * (image.width / rect.width) : widthOnScreen
}

export interface MarkedPhoto {
  uri: string
  name: string
  type: string
}

/** The marked file's name: the original's stem with "-marked", as a JPEG. */
export const markedName = (name: string) => `${name.replace(/\.[a-z0-9]+$/i, '') || 'photo'}-marked.jpg`

const loadImage = (uri: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The photo could not be read'))
    img.src = uri
  })

/**
 * Produce the marked photo. On the web target the browser's canvas draws the
 * photo at its own size and the strokes over it; on a device the markup
 * view is captured as it is shown. Either way the result is a JPEG file the
 * upload code already understands.
 */
export async function composeMarkedPhoto(input: { uri: string; name: string; strokes: Stroke[]; color: string; width: number; view: Size; image: Size; capture?: () => Promise<string> }): Promise<MarkedPhoto> {
  const name = markedName(input.name)
  if (Platform.OS !== 'web') {
    if (!input.capture) throw new Error('No capture available on this platform')
    return { uri: await input.capture(), name, type: 'image/jpeg' }
  }
  const img = await loadImage(input.uri)
  const image = { width: img.naturalWidth || input.image.width, height: img.naturalHeight || input.image.height }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width))
  canvas.height = Math.max(1, Math.round(image.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The photo could not be marked')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  paintStrokes(ctx, mapStrokesToImage(input.strokes, image, input.view), input.color, strokeWidthOnImage(input.width, image, input.view))
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('The marked photo could not be produced')
  return { uri: URL.createObjectURL(blob), name, type: 'image/jpeg' }
}
