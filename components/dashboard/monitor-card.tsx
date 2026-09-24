'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'

import { EditMonitorDialog } from '@/components/dashboard/add-monitor-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusDot } from '@/components/ui/status-dot'
import {
  formatClock,
  formatExact,
  formatResponseTime,
  formatUptime,
  hostnameOf,
} from '@/lib/utils'
import type { MonitorWithState, UiStatus } from '@/lib/types'

interface MonitorCardProps {
  monitor: MonitorWithState
  onChanged: () => void
}

export function MonitorCard({ monitor, onChanged }: MonitorCardProps) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!menuOpen) return
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const state = monitor.state
  // A monitor that exists but has never been probed is shown as CHECKING.
  const status: UiStatus = !monitor.enabled ? 'CHECKING' : (state?.status ?? 'CHECKING')

  async function mutate(action: 'toggle' | 'delete') {
    setPending(true)
    setError(null)
    setMenuOpen(false)
    try {
      const response = await fetch(`/api/monitors/${monitor.id}`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'delete' ? undefined : JSON.stringify({ enabled: !monitor.enabled }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Request failed')
        return
      }
      onChanged()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="flex flex-col transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <span className="truncate text-sm font-medium">{monitor.name}</span>
            {monitor.type === 'health' && (
              <Badge variant="outline" className="shrink-0 gap-1">
                <Activity className="h-3 w-3" />
                Health
              </Badge>
            )}
            {monitor.type === 'login' && (
              <Badge variant="outline" className="shrink-0 gap-1">
                <KeyRound className="h-3 w-3" />
                Login
              </Badge>
            )}
            {!monitor.enabled && (
              <Badge variant="outline" className="shrink-0">
                Paused
              </Badge>
            )}
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground"
          >
            {monitor.url}
          </a>
        </div>

        <div className="relative shrink-0" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Actions for ${monitor.name}`}
            aria-expanded={menuOpen}
            disabled={pending}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>

          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setMenuOpen(false)
                  setEditOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => mutate('toggle')}
              >
                {monitor.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {monitor.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-down hover:bg-down/10"
                onClick={() => mutate('delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-baseline gap-4 px-5 text-sm">
        <span className="tabular font-medium">{formatResponseTime(state?.responseTime)}</span>
        <span className="tabular text-muted-foreground">
          {formatUptime(state?.uptime30d)} uptime
        </span>
        {state?.reported && (
          <Badge variant={state.status === 'UP' ? 'up' : 'down'} className="shrink-0">
            {state.reported}
          </Badge>
        )}
      </div>

      {state?.status === 'DOWN' && state.error && (
        <p className="mx-5 mt-3 flex items-start gap-1.5 rounded-md bg-down/10 px-2.5 py-1.5 text-xs text-down">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{state.error}</span>
        </p>
      )}

      {error && <p className="mx-5 mt-3 text-xs text-down">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span title={formatExact(state?.lastCheck)}>
            Last check: {formatClock(state?.lastCheck)}
          </span>
          <span>
            {state?.incidents ?? 0} incident{(state?.incidents ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/monitor/${monitor.id}`}>View</Link>
        </Button>
      </div>

      <span className="sr-only">{hostnameOf(monitor.url)}</span>

      <EditMonitorDialog
        monitor={monitor}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onChanged}
      />
    </Card>
  )
}
