'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'

import { EditMonitorDialog } from '@/components/dashboard/add-monitor-dialog'
import { useI18n } from '@/components/i18n/i18n-provider'
import { SslBadge } from '@/components/monitor/ssl-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { UptimeBars, type Bucket } from '@/components/ui/uptime-bars'
import { cn } from '@/lib/cn'
import { hostnameOf } from '@/lib/utils'
import type { MonitorWithState, UiStatus } from '@/lib/types'

interface MonitorRowProps {
  monitor: MonitorWithState
  /** Last 24 hours, bucketed. Null while history is still loading. */
  buckets: Bucket[] | null
  /** Position in the list, for the staggered entry. */
  index?: number
  onChanged: () => void
}

export function MonitorRow({ monitor, buckets, index = 0, onChanged }: MonitorRowProps) {
  const { t: messages, format } = useI18n()
  const t = messages.row
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
  const isDown = monitor.enabled && state?.status === 'DOWN'

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
        setError(typeof body?.error === 'string' ? body.error : messages.common.requestFailed)
        return
      }
      onChanged()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setPending(false)
    }
  }

  const type = monitor.type === 'health' || monitor.type === 'login' ? monitor.type : null

  return (
    <li
      style={{ ['--i' as string]: Math.min(index, 8) }}
      className={cn(
        'reveal group relative transition-colors hover:bg-accent/40',
        isDown && 'bg-down/[0.035]',
        !monitor.enabled && 'opacity-70',
      )}
    >
      {isDown && <span className="absolute inset-y-0 left-0 w-[2px] bg-down" aria-hidden />}

      <div className="grid gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_76px_76px_36px] lg:items-center">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-3">
          <StatusDot status={status} className="mt-1.5" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/monitor/${monitor.id}`}
                className="truncate text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
              >
                {monitor.name}
              </Link>
              {type && (
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px] font-normal text-muted-foreground">
                  {t.types[type]}
                </Badge>
              )}
              {!monitor.enabled && (
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
                  {t.paused}
                </Badge>
              )}
              {state?.reported && (
                <Badge variant={state.status === 'UP' ? 'up' : 'down'} className="shrink-0 px-1.5 py-0 text-[11px]">
                  {state.reported}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">{hostnameOf(monitor.url)}</span>
              <SslBadge expiresAt={monitor.sslExpiresAt} className="relative z-10 px-1.5 py-0 text-[11px]" />
            </div>
          </div>
        </div>

        {/* 24h history */}
        <div className="min-w-0">
          {buckets ? (
            <UptimeBars buckets={buckets} className="relative z-10 h-6" t={messages.bars} />
          ) : (
            <div className="h-6 animate-pulse rounded-[3px] bg-muted" />
          )}
          <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-muted-foreground/80">
            <span>{t.dayAgo}</span>
            <span title={format.exact(state?.lastCheck)}>
              {state?.lastCheck ? t.checkedAt(format.clock(state.lastCheck)) : t.notChecked}
            </span>
          </div>
        </div>

        {/* Numbers */}
        <div className="flex items-baseline gap-6 lg:contents">
          <Metric label={t.response} value={format.responseTime(state?.responseTime)} />
          <Metric
            label={t.uptime30d}
            value={format.uptime(state?.uptime30d)}
            className={isDown ? 'text-down' : undefined}
          />
        </div>

        {/* Actions */}
        <div className="absolute right-3 top-3 z-10 lg:relative lg:right-auto lg:top-auto" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label={t.actionsFor(monitor.name)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            disabled={pending}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-44 origin-top-right animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-panel"
            >
              <MenuItem
                onClick={() => {
                  setMenuOpen(false)
                  setEditOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                {t.edit}
              </MenuItem>
              <MenuItem onClick={() => mutate('toggle')}>
                {monitor.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {monitor.enabled ? t.pause : t.resume}
              </MenuItem>
              <Link
                role="menuitem"
                href={`/monitor/${monitor.id}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                {t.details}
              </Link>
              <div className="my-1 h-px bg-border" />
              <MenuItem destructive onClick={() => mutate('delete')}>
                <Trash2 className="h-3.5 w-3.5" />
                {t.delete}
              </MenuItem>
            </div>
          )}
        </div>
      </div>

      {(isDown && state?.error) || error ? (
        <div className="px-5 pb-4 lg:pl-[2.6rem]">
          <p className="relative z-10 flex items-start gap-1.5 text-xs text-down">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error ?? state?.error}</span>
          </p>
        </div>
      ) : null}

      <EditMonitorDialog monitor={monitor} open={editOpen} onOpenChange={setEditOpen} onSaved={onChanged} />
    </li>
  )
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="lg:text-right">
      <div className="text-[11px] text-muted-foreground lg:hidden">{label}</div>
      <div className={cn('font-mono text-sm tabular', className)}>{value}</div>
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  destructive,
}: {
  children: React.ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        destructive ? 'text-down hover:bg-down/10' : 'hover:bg-accent',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
