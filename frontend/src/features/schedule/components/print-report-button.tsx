import { Button } from '@/components/ui/button'

interface Props {
  onClick: () => void
  className?: string
}

export function PrintReportButton({ onClick, className }: Props) {
  return (
    <Button variant='outline' size='sm' className={className} onClick={onClick}>
      Export PDF
    </Button>
  )
}
