import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { projectSetupReadinessKey } from '@/features/projects/hooks/use-projects'
import type { ProjectSchedule } from '../data/schema'

export const useProjectSchedule = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<ProjectSchedule | null>({
    queryKey: ['schedule', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/schedule`).then((r) => r.data.data),
    enabled: !!projectId && (options.enabled ?? true),
  })

export interface GenerateJob {
  id?: string
  jobId?: string
  status: 'processing' | 'running' | 'done' | 'error'
  jobStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  step: string
  currentStep?: number
  totalSteps?: number
  steps?: Array<{ label: string; description: string }>
  progress?: number
  message?: string | null
  error?: string | null
  errorCode?: string | null
  attempts?: number
  maxAttempts?: number
  canRetry?: boolean
  revisionId?: string | null
  projectId: string
}

// Poll job status every 3 seconds until done or error. `pollNonce` restarts
// polling for the same job id after a retry.
function useJobPoller(
  projectId: string,
  jobId: string | null,
  onDone: () => void,
  pollNonce = 0
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [job, setJob] = useState<GenerateJob | null>(null)

  useEffect(() => {
    if (!jobId) return

    const poll = async () => {
      try {
        const res = await apiClient.get(
          `/projects/${projectId}/schedule/job/${jobId}`
        )
        const data: GenerateJob = res.data.data
        setJob(data)
        if (data.status === 'done') {
          if (intervalRef.current) clearInterval(intervalRef.current)
          onDone()
        } else if (data.status === 'error') {
          if (intervalRef.current) clearInterval(intervalRef.current)
        }
      } catch {
        if (intervalRef.current) clearInterval(intervalRef.current)
        setJob((prev) =>
          prev
            ? { ...prev, status: 'error', error: 'Lost connection to server' }
            : null
        )
      }
    }

    poll() // immediate first check
    intervalRef.current = setInterval(poll, 3000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId, projectId, onDone, pollNonce])

  return job
}

export function useGenerateSchedule(projectId: string) {
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const [pollNonce, setPollNonce] = useState(0)

  const onDone = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['schedule', projectId] })
    qc.invalidateQueries({ queryKey: ['activities', projectId] })
    qc.invalidateQueries({ queryKey: ['schedule-revisions', projectId] })
    qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) })
    setJobId(null)
  }, [qc, projectId])

  const job = useJobPoller(projectId, jobId, onDone, pollNonce)

  const mutation = useMutation({
    mutationFn: ({ file, label }: { file: File; label?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      if (label?.trim()) {
        fd.append('label', label.trim())
      }
      return apiClient
        .post(`/projects/${projectId}/schedule/generate`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data as { jobId: string })
    },
    onSuccess: ({ jobId: id }) => {
      setJobId(id)
    },
  })

  // Re-queues the same durable job (keeps the uploaded content and revision label).
  const { mutateAsync: retryMutateAsync, isPending: isRetrying } = useMutation({
    mutationFn: (id: string) =>
      apiClient
        .post(`/projects/${projectId}/schedule/job/${id}/retry`)
        .then((r) => r.data.data as GenerateJob),
    onSuccess: () => {
      setPollNonce((nonce) => nonce + 1)
      qc.invalidateQueries({ queryKey: ['jobs', projectId] })
    },
  })

  const retry = useCallback(async () => {
    if (!jobId) return null
    return retryMutateAsync(jobId)
  }, [jobId, retryMutateAsync])

  const isPending =
    mutation.isPending ||
    isRetrying ||
    job?.status === 'processing' ||
    job?.status === 'running'
  const currentStep = mutation.isPending ? 'Uploading file…' : (job?.step ?? '')
  const error =
    job?.status === 'error' ? (job.error ?? 'Generation failed') : undefined
  const canRetry =
    job?.status === 'error' && Boolean(job?.canRetry) && Boolean(jobId)

  return {
    trigger: mutation.mutateAsync,
    retry,
    canRetry,
    isRetrying,
    isPending,
    currentStep,
    error,
    errorCode: job?.errorCode ?? null,
    attempts: job?.attempts ?? 0,
    job,
    jobId,
  }
}
