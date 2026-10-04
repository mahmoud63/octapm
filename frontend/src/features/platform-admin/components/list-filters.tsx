import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = '__all__'

/** A search box that reports its value after the person stops typing. */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  // The box owns its text; the parent only hears the settled value.
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== value) onChange(draft)
    }, 300)
    return () => clearTimeout(t)
  }, [draft, value, onChange])
  return (
    <div className='relative w-full sm:w-64'>
      <Search
        className='absolute top-2.5 left-2.5 size-4 text-muted-foreground'
        aria-hidden
      />
      <Input
        className='pl-8'
        value={draft}
        maxLength={120}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  )
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select
      value={value || ALL}
      onValueChange={(v) => onChange(v === ALL ? '' : v)}
    >
      <SelectTrigger className='w-full sm:w-44' aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
