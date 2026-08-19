import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatClock, formatExact, formatResponseTime } from '@/lib/utils'
import type { HistoryEntry } from '@/lib/types'

/** Most recent checks first. */
export function HistoryTable({ entries, limit = 50 }: { entries: HistoryEntry[]; limit?: number }) {
  const rows = [...entries].reverse().slice(0, limit)

  if (!rows.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        No checks recorded yet.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>HTTP</TableHead>
          <TableHead className="text-right">Response</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((entry) => (
          <TableRow key={`${entry.timestamp}-${entry.monitorId}`}>
            <TableCell
              className="tabular whitespace-nowrap text-muted-foreground"
              title={formatExact(entry.timestamp)}
            >
              {formatClock(entry.timestamp)}
            </TableCell>
            <TableCell>
              <Badge variant={entry.status === 'UP' ? 'up' : 'down'}>{entry.status}</Badge>
            </TableCell>
            <TableCell className="tabular">
              {entry.statusCode ?? <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="tabular text-right">
              {entry.responseTime === null ? (
                <span className="text-muted-foreground" title={entry.error ?? undefined}>
                  —
                </span>
              ) : (
                formatResponseTime(entry.responseTime)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
