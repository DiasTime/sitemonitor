'use client'

import { useI18n } from '@/components/i18n/i18n-provider'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { HistoryEntry } from '@/lib/types'

/** Most recent checks first. */
export function HistoryTable({ entries, limit = 50 }: { entries: HistoryEntry[]; limit?: number }) {
  const { t: messages, format } = useI18n()
  const t = messages.history
  const rows = [...entries].reverse().slice(0, limit)

  if (!rows.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        {t.empty}
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.time}</TableHead>
          <TableHead>{t.status}</TableHead>
          <TableHead>{t.http}</TableHead>
          <TableHead className="text-right">{t.response}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((entry) => (
          <TableRow key={`${entry.timestamp}-${entry.monitorId}`}>
            <TableCell
              className="tabular whitespace-nowrap text-muted-foreground"
              title={format.exact(entry.timestamp)}
            >
              {format.clock(entry.timestamp)}
            </TableCell>
            <TableCell>
              <Badge variant={entry.status === 'UP' ? 'up' : 'down'}>
                {entry.status === 'UP' ? t.up : t.down}
              </Badge>
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
                format.responseTime(entry.responseTime)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
