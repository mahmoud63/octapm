import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Keyboard, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Reads a barcode or QR code.
 *
 * Two ways in, because a warehouse has both. The camera path uses the
 * browser's own BarcodeDetector where it exists — Chrome on Android, which is
 * what a phone on site is running — and needs no library. Everywhere else, and
 * for the handheld scanners most stores actually use (they type into the
 * focused field and press Enter), there is a text box.
 *
 * The keyboard path is not a fallback anyone should apologise for: it is how a
 * wedge scanner works, and it is faster than a camera when you have one.
 */

type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

const detectorCtor = (): BarcodeDetectorCtor | null => {
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector
  return typeof candidate === 'function' ? candidate : null
}

interface Props {
  onScan: (code: string) => void
  busy?: boolean
  autoFocus?: boolean
  className?: string
}

export function CodeScanner({ onScan, busy = false, autoFocus = true, className }: Props) {
  const [typed, setTyped] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraSupported = Boolean(detectorCtor()) && Boolean(navigator.mediaDevices)

  // Stop the camera the moment it is not wanted: a live stream left running is
  // a hot phone and a recording light nobody asked for.
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => stopCamera, [])

  useEffect(() => {
    if (!cameraOn) {
      stopCamera()
      return
    }

    let cancelled = false
    let frame = 0
    const Detector = detectorCtor()
    if (!Detector) return

    const detector = new Detector({
      formats: ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'data_matrix'],
    })

    const run = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The back camera is the one pointing at the pallet.
          video: { facingMode: { ideal: 'environment' } },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const tick = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const found = await detector.detect(videoRef.current)
            const code = found[0]?.rawValue?.trim()
            if (code) {
              setCameraOn(false)
              onScan(code)
              return
            }
          } catch {
            // A frame that will not decode is normal; keep looking.
          }
          frame = window.setTimeout(tick, 250)
        }
        void tick()
      } catch (error) {
        if (cancelled) return
        setCameraError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Camera permission was refused. Type or scan the code instead.'
            : 'The camera could not be opened. Type or scan the code instead.'
        )
        setCameraOn(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      window.clearTimeout(frame)
      stopCamera()
    }
  }, [cameraOn, onScan])

  const submit = () => {
    const code = typed.trim()
    if (!code) return
    setTyped('')
    onScan(code)
  }

  return (
    <div className={cn('space-y-3', className)} data-testid='uat-code-scanner'>
      <div className='flex gap-2'>
        <div className='relative flex-1'>
          <Keyboard className='absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            autoFocus={autoFocus}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              // A handheld scanner types the code and presses Enter.
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            placeholder='Scan or type a barcode, QR code or SKU'
            className='ps-9'
            data-testid='uat-scan-input'
            disabled={busy}
          />
        </div>
        <Button onClick={submit} disabled={busy || !typed.trim()} data-testid='uat-scan-submit'>
          {busy ? <Loader2 className='size-4 animate-spin' /> : 'Look up'}
        </Button>
        {cameraSupported && (
          <Button
            variant={cameraOn ? 'secondary' : 'outline'}
            onClick={() => {
              setCameraError(null)
              setCameraOn((on) => !on)
            }}
            aria-pressed={cameraOn}
            title={cameraOn ? 'Stop the camera' : 'Scan with the camera'}
            data-testid='uat-scan-camera'
          >
            {cameraOn ? <CameraOff className='size-4' /> : <Camera className='size-4' />}
          </Button>
        )}
      </div>

      {cameraOn && (
        <div className='octa-notch relative overflow-hidden bg-black' style={{ '--notch': '14px' } as React.CSSProperties}>
          <video
            ref={videoRef}
            className='aspect-video w-full object-cover'
            muted
            playsInline
          />
          {/* A target, so the person holding the phone knows where to aim. */}
          <div className='pointer-events-none absolute inset-0 grid place-items-center'>
            <div className='h-28 w-56 rounded-sm border-2 border-brand-accent/80' />
          </div>
        </div>
      )}

      {cameraError && (
        <p className='text-xs text-error-foreground' role='status'>
          {cameraError}
        </p>
      )}
      {!cameraSupported && (
        <p className='text-xs text-muted-foreground'>
          This browser cannot use the camera to scan. A handheld scanner works
          in the box above — it types the code and presses Enter.
        </p>
      )}
    </div>
  )
}
