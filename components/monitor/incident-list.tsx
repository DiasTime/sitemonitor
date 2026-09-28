'use client'

import { useI18n } from '@/components/i18n/i18n-provider'
import { Badge } from '@/components/ui/badge'
import type { Incident } from '@/lib/types'

export function IncidentList({
  incidents,
  monitorName,
}: {
  incidents: Incident[]
  monitorName: string
}) {
  const { t: messages, format } = useI18n()
  const t = messages.incidents

  if (!incidents.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        {t.empty}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {incidents.map((incident) => {
        const ongoing = incident.status === 'ongoing'
        const duration = ongoing
          ? Date.now() - new Date(incident.startedAt).getTime()
          : incident.durationMs

        return (
          <li key={incident.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div
                className="flex items-center gap-2 text-sm font-medium"
                title={format.exact(incident.startedAt)}
              >
                <span aria-hidden>{ongoing ? '🔴' : '⚪️'}</span>
                {format.incidentDate(incident.startedAt)}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.unavailable(monitorName)}
                {incident.error ? `: ${incident.error}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-6 text-sm">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t.duration}
                </div>
                <div className="tabular mt-0.5">{format.duration(duration)}</div>
              </div>
              <Badge variant={ongoing ? 'down' : 'outline'}>
                {ongoing ? t.ongoing : t.resolved}
              </Badge>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
