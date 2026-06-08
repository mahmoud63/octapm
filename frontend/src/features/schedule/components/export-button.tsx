import { useState } from 'react'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface Props {
  projectId: string
  className?: string
}

export function ExportButton({ projectId, className }: Props) {
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get(
        `/projects/${projectId}/export/xlsx`,
        {
          responseType: 'blob',
        }
      )

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.setAttribute('download', 'project-export.xlsx')
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
      toast.success('XLSX export downloaded')
    } catch {
      toast.error('Failed to export XLSX')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant='outline'
      size='sm'
      className={className}
      onClick={handleExport}
      disabled={loading}
    >
      {loading ? 'Exporting...' : 'Export XLSX'}
    </Button>
  )
}
