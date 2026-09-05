import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { DelayType, NoteKind } from './use-daily-log'

/**
 * Daily report auto-draft (OCTA-AI-DAILY-030): the day's records, photos and
 * dictated notes become a proposed summary, notes, delays and photo
 * captions; the person keeps what is right and applies it.
 */

export interface DailyLogAiStatus {
  enabled: boolean
  provider: string | null
  model: string | null
  vision: boolean
  transcription: boolean
  maxPhotos: number
}

export interface DraftPhoto {
  id: string
  ref: string
  caption: string | null
  takenAt: string | null
  thumbnailUrl: string
  locationName: string | null
  tags: string[]
  included: boolean
}

export interface DailyLogDraft {
  summary: string
  workPerformed: Array<{
    text: string
    activity: string | null
    sources: string[]
  }>
  notes: Array<{ kind: NoteKind; text: string }>
  delays: Array<{ type: DelayType; description: string; hoursLost: number }>
  photoCaptions: Array<{
    photoId: string
    ref: string
    caption: string
    existing: string | null
  }>
  missing: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface DailyLogDraftResult {
  degraded: boolean
  reason?: string | null
  date: string
  draft: DailyLogDraft
  evidence: {
    photos: DraftPhoto[]
    counts: {
      photos: number
      progress: number
      inspections: number
      punch: number
      safety: number
      entries: number
      notes: boolean
    }
    includedImages: number
  }
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

export interface ApplyDailyLogDraftPayload {
  summary?: string | null
  notes?: Array<{ kind: NoteKind; text: string }>
  delays?: Array<{ type: DelayType; description: string; hoursLost: number }>
  photoCaptions?: Array<{ photoId: string; caption: string }>
  overwriteCaptions?: boolean
}

export interface ApplyDailyLogDraftResult {
  applied: {
    summary: boolean
    notes: number
    delays: number
    captions: number
    skippedCaptions: number
  }
}

const base = (projectId: string) => `/projects/${projectId}/daily-logs`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const useDailyLogAiStatus = (projectId: string, enabled = true) =>
  useQuery<DailyLogAiStatus>({
    queryKey: ['daily-log-ai', projectId, 'status'],
    queryFn: () =>
      data<DailyLogAiStatus>(apiClient.get(`${base(projectId)}/ai/status`)),
    staleTime: 5 * 60_000,
    enabled: Boolean(projectId) && enabled,
  })

export const useDraftDailyLog = (projectId: string) =>
  useMutation({
    mutationFn: ({
      date,
      notes,
      includePhotos,
      photoIds,
    }: {
      date: string
      notes?: string | null
      includePhotos?: boolean
      photoIds?: string[]
    }) =>
      data<DailyLogDraftResult>(
        apiClient.post(
          `${base(projectId)}/${date}/ai/draft`,
          {
            notes: notes || null,
            includePhotos: includePhotos !== false,
            ...(photoIds?.length ? { photoIds } : {}),
          },
          { timeout: 180_000 }
        )
      ),
  })

export const useApplyDailyLogDraft = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      payload,
    }: {
      date: string
      payload: ApplyDailyLogDraftPayload
    }) =>
      data<ApplyDailyLogDraftResult>(
        apiClient.post(`${base(projectId)}/${date}/ai/apply`, payload)
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-log', projectId] })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
      qc.invalidateQueries({
        predicate: (query) => {
          const root = String(query.queryKey[0] ?? '')
          return root.startsWith('photo') || root.startsWith('attachment')
        },
      })
    },
  })
}

export const useTranscribeAudio = (projectId: string) =>
  useMutation({
    mutationFn: ({
      blob,
      language,
    }: {
      blob: Blob
      language?: string | null
    }) => {
      const form = new FormData()
      const extension = blob.type.includes('mp4')
        ? 'mp4'
        : blob.type.includes('ogg')
          ? 'ogg'
          : 'webm'
      form.append('audio', blob, `note.${extension}`)
      if (language) form.append('language', language)
      return data<{ text: string; provider: string; model: string }>(
        apiClient.post(`${base(projectId)}/ai/transcribe`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000,
        })
      )
    },
  })

// ─── Dictation in the browser ─────────────────────────────────────────────

interface RecognitionResultLike {
  isFinal: boolean
  0?: { transcript: string }
  length: number
}
interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}
interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: RecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type RecognitionCtor = new () => RecognitionLike

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const host = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null
}

/** Speech-to-text in the browser (no server round trip) where the browser offers it. */
export const useSpeechDictation = ({
  onFinal,
  onInterim,
  lang,
}: {
  onFinal: (text: string) => void
  onInterim?: (text: string) => void
  lang?: string
}) => {
  const ctor = recognitionCtor()
  const current = useRef<RecognitionLike | null>(null)
  const [listening, setListening] = useState(false)

  const stop = () => {
    current.current?.stop()
  }
  const start = () => {
    if (!ctor || current.current) return
    const recognition = new ctor()
    recognition.lang =
      lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US')
    recognition.interimResults = true
    recognition.continuous = true
    recognition.onresult = (event) => {
      let finalText = ''
      let interim = ''
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript ?? ''
        if (result?.isFinal) finalText += transcript
        else interim += transcript
      }
      if (finalText.trim()) onFinal(finalText.trim())
      onInterim?.(interim.trim())
    }
    recognition.onend = () => {
      current.current = null
      setListening(false)
      onInterim?.('')
    }
    recognition.onerror = () => {
      current.current = null
      setListening(false)
      onInterim?.('')
    }
    current.current = recognition
    recognition.start()
    setListening(true)
  }
  return { supported: Boolean(ctor), listening, start, stop }
}

/** Records a voice note for server-side transcription when the browser cannot dictate itself. */
export const useAudioRecorder = ({
  onRecording,
}: {
  onRecording: (blob: Blob) => void
}) => {
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)

  const start = async () => {
    if (!supported || recorder.current) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const instance = new MediaRecorder(stream)
    chunks.current = []
    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data)
    }
    instance.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      const blob = new Blob(chunks.current, {
        type: instance.mimeType || 'audio/webm',
      })
      recorder.current = null
      setRecording(false)
      if (blob.size > 0) onRecording(blob)
    }
    recorder.current = instance
    instance.start()
    setRecording(true)
  }
  const stop = () => {
    recorder.current?.stop()
  }
  return { supported, recording, start, stop }
}
