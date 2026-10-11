import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { platformIntegrationApi } from '@/services/platform-admin/integration-api'
import { Input } from '@/components/ui/input'

/**
 * Platform search: companies by name, people by name or email, projects by
 * name — identifying fields only, never a project's records or documents.
 */
export function PlatformSearch() {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), 250)
    return () => clearTimeout(timer)
  }, [q])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const query = useQuery({ queryKey: ['platform-admin', 'search', term], queryFn: () => platformIntegrationApi.search(term), enabled: term.length >= 2 })
  const r = query.data
  const empty = r && !r.companies.length && !r.users.length && !r.projects.length
  const done = () => {
    setOpen(false)
    setQ('')
  }
  return (
    <div ref={box} className='relative w-full max-w-sm' data-testid='platform-search'>
      <Search className='absolute top-2 left-2 size-4 text-muted-foreground' aria-hidden />
      <Input className='h-8 pl-8' placeholder='Search companies, people, projects…' value={q} onChange={(event) => { setQ(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)} aria-label='Search the platform' />
      {open && term.length >= 2 ? (
        <div className='absolute top-9 right-0 left-0 z-20 max-h-96 overflow-y-auto rounded-md border bg-popover p-2 text-sm shadow-md'>
          {query.isLoading ? <p className='px-2 py-1 text-muted-foreground'>Searching…</p> : null}
          {empty ? <p className='px-2 py-1 text-muted-foreground'>Nothing found.</p> : null}
          {r?.companies.length ? <p className='px-2 pt-1 text-[11px] font-semibold text-muted-foreground uppercase'>Companies</p> : null}
          {r?.companies.map((c) => (
            <Link key={c.id} to='/platform-admin/companies/$orgId' params={{ orgId: c.id }} onClick={done} className='block rounded px-2 py-1 hover:bg-muted'>{c.name} <span className='text-xs text-muted-foreground'>· {c.kind} · {c.status}</span></Link>
          ))}
          {r?.users.length ? <p className='px-2 pt-2 text-[11px] font-semibold text-muted-foreground uppercase'>People</p> : null}
          {r?.users.map((u) => (
            <Link key={u.id} to='/platform-admin/users' search={{ q: u.email }} onClick={done} className='block rounded px-2 py-1 hover:bg-muted'>{u.name || u.email} <span className='text-xs text-muted-foreground'>· {u.email}</span></Link>
          ))}
          {r?.projects.length ? <p className='px-2 pt-2 text-[11px] font-semibold text-muted-foreground uppercase'>Projects</p> : null}
          {r?.projects.map((p) => (
            <Link key={p.id} to='/platform-admin/companies/$orgId' params={{ orgId: p.organisation.id }} onClick={done} className='block rounded px-2 py-1 hover:bg-muted'>{p.name} <span className='text-xs text-muted-foreground'>· {p.organisation.name} · {p.status}</span></Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
