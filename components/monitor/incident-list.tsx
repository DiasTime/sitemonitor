import { Badge } from '@/components/ui/badge'
import { formatDuration, formatIncidentDate } from '@/lib/utils'
import type { Incident } from '@/lib/types'

export function IncidentList({
  incidents,
  monitorName,
}: {
  incidents: Incident[]
  monitorName: string
}) {
  if (!incidents.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        No incidents recorded. 🎉
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
              <div className="flex items-center gap-2 text-sm font-medium">
                <span aria-hidden>{ongoing ? '🔴' : '⚪️'}</span>
                {formatIncidentDate(incident.startedAt)}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {monitorName} became unavailable
                {incident.error ? ` — ${incident.error}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-6 text-sm">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Duration
                </div>
                <div className="tabular mt-0.5">{formatDuration(duration)}</div>
              </div>
              <Badge variant={ongoing ? 'down' : 'outline'}>
                {ongoing ? 'Ongoing' : 'Resolved'}
              </Badge>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
