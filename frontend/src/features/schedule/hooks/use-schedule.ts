import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { ProjectSchedule } from '../data/schema'

export const useProjectSchedule = (projectId: string) =>
  useQuery<ProjectSchedule | null>({
    queryKey: ['schedule', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/schedule`).then((r) => r.data.data),
    enabled: !!projectId,
  })

export interface GenerateJob {
  status: 'processing' | 'running' | 'done' | 'error'
  step: string
  currentStep?: number
  totalSteps?: number
  steps?: Array<{ label: string; description: string }>
  progress?: number
  error?: string
  projectId: string
}

// Poll job status every 3 seconds until done or error
function useJobPoller(
  projectId: string,
  jobId: string | null,
  onDone: () => void
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
  }, [jobId, projectId, onDone])

  return job
}

export function useGenerateSchedule(projectId: string) {
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)

  const onDone = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['schedule', projectId] })
    qc.invalidateQueries({ queryKey: ['activities', projectId] })
    qc.invalidateQueries({ queryKey: ['schedule-revisions', projectId] })
    setJobId(null)
  }, [qc, projectId])

  const job = useJobPoller(projectId, jobId, onDone)

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

  const isPending =
    mutation.isPending ||
    job?.status === 'processing' ||
    job?.status === 'running'
  const currentStep = mutation.isPending ? 'Uploading file…' : (job?.step ?? '')
  const error = job?.status === 'error' ? job.error : undefined

  return {
    trigger: mutation.mutateAsync,
    isPending,
    currentStep,
    error,
    job,
  }
}
