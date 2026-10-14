import * as React from 'react'
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { formatResponseTimeRu, plural } from '@/lib/ru'
import {
  formatAvailability,
  formatSpan,
  zoneOffsetMs,
  type Report,
  type ReportUnit,
} from '@/lib/report'

/**
 * The uptime report as a PDF, drawn with @react-pdf/renderer. Only ever loaded
 * on demand (see report-dialog.tsx), so the dashboard does not carry the PDF
 * engine until someone asks for a report. Always Russian on a white page,
 * whatever language and theme the dashboard is in: it is a document to pass on.
 */

const FONT = 'Geist'

/** `base` is the folder holding the Geist files: a URL in the browser, a path in a script. */
export function registerReportFonts(base: string) {
  Font.register({
    family: FONT,
    fonts: [
      { src: `${base}/Geist-Regular.ttf`, fontWeight: 400 },
      { src: `${base}/Geist-Medium.ttf`, fontWeight: 500 },
      { src: `${base}/Geist-SemiBold.ttf`, fontWeight: 600 },
    ],
  })
  // The built-in hyphenation is English and would cut Russian words at random.
  Font.registerHyphenationCallback((word) => [word])
}

const monitorsGen = (count: number) => plural(count, ['монитора', 'мониторов', 'мониторов'])
const outages = (count: number) => plural(count, ['сбой', 'сбоя', 'сбоев'])
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)

const T = {
  title: 'Отчёт о доступности',
  generated: (when: string) => `Сформирован ${when}`,
  scopeAll: (count: number) => `Все мониторы (${count})`,
  timeZone: (zone: string) => `Время в поясе ${zone}`,
  summaryClean: 'За период не было ни одного сбоя.',
  summary: (incidents: number, affected: number, total: number, downtime: string) =>
    `${incidents} ${outages(incidents)} на ${affected} из ${total} ${monitorsGen(total)}, суммарный простой ${downtime}.`,
  summarySingle: (incidents: number, downtime: string) =>
    `${incidents} ${outages(incidents)}, суммарный простой ${downtime}.`,
  longest: (name: string, duration: string) => `Самый долгий сбой: ${name}, ${duration}.`,
  longestSingle: (duration: string) => `Самый долгий сбой: ${duration}.`,
  ongoing: (count: number) => `Не завершено на момент отчёта: ${count}.`,
  kpi: {
    availability: 'Доступность',
    availabilityNote: 'доля времени без сбоев',
    incidents: 'Сбоев',
    incidentsNote: (affected: number, total: number) => `на ${affected} из ${total} ${monitorsGen(total)}`,
    incidentsNoteSingle: 'за период',
    downtime: 'Простой',
    downtimeNote: 'суммарно по мониторам',
    downtimeNoteSingle: 'суммарно',
    mttr: 'Восстановление',
    mttrNote: 'в среднем на сбой',
  },
  chart: { hour: 'Сбои по часам', day: 'Сбои по дням', week: 'Сбои по неделям' },
  chartNote: {
    hour: 'Сколько сбоев началось в каждый час',
    day: 'Сколько сбоев началось в каждый день',
    week: 'Сколько сбоев началось за каждую неделю',
  },
  monitors: 'Мониторы',
  columns: {
    monitor: 'Монитор',
    availability: 'Доступность',
    incidents: 'Сбоев',
    downtime: 'Простой',
    longest: 'Самый долгий',
    response: 'Ср. отклик',
  },
  paused: 'на паузе',
  timeline: 'Хронология сбоев',
  causes: 'Причины сбоев',
  causeColumns: { cause: 'Причина', incidents: 'Сбоев', downtime: 'Простой' },
  log: 'Журнал сбоев',
  logColumns: { monitor: 'Монитор', started: 'Начало', ended: 'Конец', duration: 'Длительность', cause: 'Причина' },
  ongoingLabel: 'продолжается',
  noIncidents: 'За этот период ничего не падало.',
  method:
    'Доступность считается по времени: доля периода, когда у монитора не было открытого сбоя. Сбой начинается с первой неудачной проверки и заканчивается первой успешной.',
  checks: (total: string, failed: string) => `Проверок за период: ${total}, неудачных: ${failed}.`,
  historyNote: (since: string) =>
    `История проверок хранится ограниченное время, поэтому число проверок и средний отклик посчитаны с ${since.replace(/\.$/, '')}.`,
  footer: 'Site Monitor · отчёт о доступности',
  page: (page: number, total: number) => `${page} из ${total}`,
}

// The dashboard's light theme (app/globals.css), as hex.
const C = {
  ink: '#0E0E11',
  text: '#2A2A30',
  muted: '#67676F',
  faint: '#9D9DA5',
  line: '#E1E1E5',
  hairline: '#ECECEF',
  panel: '#F0F0F2',
  up: '#27915F',
  down: '#D42B37',
  warn: '#C27C0E',
}

const s = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFF',
    fontFamily: FONT,
    fontSize: 9,
    color: C.text,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    // No lineHeight here: inherited by the footer's page counter, it makes react-pdf draw nothing.
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  brandMark: {
    width: 15,
    height: 15,
    borderRadius: 4,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBeacon: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.up },
  brandName: { marginLeft: 7, fontSize: 10, fontWeight: 600, color: C.ink, letterSpacing: -0.2 },
  generated: { marginLeft: 'auto', fontSize: 7.5, color: C.faint },
  title: { marginTop: 28, fontSize: 24, fontWeight: 600, color: C.ink, letterSpacing: -0.6, lineHeight: 1.1 },
  period: { marginTop: 8, fontSize: 12, fontWeight: 500, color: C.text },
  scope: { marginTop: 4, fontSize: 8, color: C.muted },
  summary: { marginTop: 18, fontSize: 10.5, lineHeight: 1.5, color: C.text, maxWidth: 440 },
  kpis: {
    marginTop: 18,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
  },
  kpi: { flex: 1, paddingVertical: 11, paddingHorizontal: 12 },
  kpiDivider: { borderLeftWidth: 1, borderLeftColor: C.line },
  kpiLabel: { fontSize: 7.5, color: C.muted },
  kpiValue: { marginTop: 5, fontSize: 17, fontWeight: 600, color: C.ink, letterSpacing: -0.3, lineHeight: 1.1 },
  kpiNote: { marginTop: 4, fontSize: 7, color: C.faint },
  section: { marginTop: 26 },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: C.ink, letterSpacing: -0.1 },
  sectionNote: { marginTop: 2, fontSize: 7.5, color: C.muted },
  sectionBody: { marginTop: 10 },
  th: { fontSize: 7, color: C.muted },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5.5,
    borderBottomWidth: 0.75,
    borderBottomColor: C.hairline,
  },
  num: { textAlign: 'right' },
  name: { fontSize: 9, fontWeight: 500, color: C.ink },
  host: { marginTop: 1, fontSize: 7, color: C.muted },
  empty: { fontSize: 9, color: C.muted },
  method: {
    marginTop: 28,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.line,
    fontSize: 7.5,
    lineHeight: 1.5,
    color: C.muted,
  },
  footer: {
    position: 'absolute',
    left: 40,
    right: 40,
    bottom: 24,
    flexDirection: 'row',
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: C.hairline,
    fontSize: 7,
    color: C.faint,
  },
})

function availabilityColor(value: number | null): string {
  if (value === null) return C.muted
  if (value >= 99.9) return C.up
  if (value >= 99) return C.warn
  return C.down
}

/** "Asia/Almaty (UTC+5)" */
function zoneLabel(timeZone: string, at: number): string {
  const minutes = Math.round(zoneOffsetMs(at, timeZone) / 60_000)
  const sign = minutes < 0 ? '-' : '+'
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  const offset = minutes === 0 ? 'UTC' : `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
  return timeZone === 'UTC' ? 'UTC' : `${timeZone} (${offset})`
}

function makeDates(timeZone: string) {
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ru-RU', { timeZone, hour12: false, ...options })
  const day = fmt({ day: 'numeric', month: 'long', year: 'numeric' })
  const dayMonth = fmt({ day: 'numeric', month: 'long' })
  const dayOnly = fmt({ day: 'numeric' })
  const monthYear = fmt({ month: 'numeric', year: 'numeric' })
  const year = fmt({ year: 'numeric' })
  const short = fmt({ day: 'numeric', month: 'short' })
  const clock = fmt({ hour: '2-digit', minute: '2-digit' })
  const stamp = fmt({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const generated = fmt({ dateStyle: 'long', timeStyle: 'short' })

  return {
    /** "1 - 30 сентября 2026 г.", the shared month and year said once; one date for a single day. */
    period(from: string, to: string): string {
      const first = new Date(from)
      // `to` is exclusive: midnight after the last day, or now.
      const last = new Date(Date.parse(to) - 1)
      const end = day.format(last)
      if (day.format(first) === end) return end
      if (monthYear.format(first) === monthYear.format(last)) return `${dayOnly.format(first)} - ${end}`
      if (year.format(first) === year.format(last)) return `${dayMonth.format(first)} - ${end}`
      return `${day.format(first)} - ${end}`
    },
    axis(iso: string, unit: ReportUnit): string {
      return unit === 'hour' ? clock.format(new Date(iso)) : short.format(new Date(iso))
    },
    stamp: (iso: string) => stamp.format(new Date(iso)),
    generated: (iso: string) => generated.format(new Date(iso)),
    day: (iso: string) => day.format(new Date(iso)),
  }
}

export function ReportDocument({ report }: { report: Report }) {
  const t = T
  const dates = makeDates(report.timeZone)
  const span = formatSpan
  const { totals } = report
  const single = report.monitorId !== null
  const subject = single ? report.monitors[0] : null
  const periodLabel = dates.period(report.from, report.to)
  const ongoing = report.incidents.filter((incident) => incident.endedAt === null).length

  const summary =
    totals.incidents === 0
      ? [t.summaryClean]
      : [
          single
            ? t.summarySingle(totals.incidents, span(totals.downtimeMs))
            : t.summary(totals.incidents, totals.affected, totals.monitors, span(totals.downtimeMs)),
          totals.longest && totals.longest.durationMs > 0
            ? single
              ? t.longestSingle(span(totals.longest.durationMs))
              : t.longest(totals.longest.monitorName, span(totals.longest.durationMs))
            : null,
          ongoing ? t.ongoing(ongoing) : null,
        ].filter(Boolean)

  const historyPartial =
    report.historyFrom !== null && Date.parse(report.historyFrom) > Date.parse(report.from)

  return (
    <Document
      title={`${t.title}, ${periodLabel}`}
      author="Site Monitor"
      creator="Site Monitor"
      producer="Site Monitor"
      language="ru"
    >
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={s.brandMark}>
            <View style={s.brandBeacon} />
          </View>
          <Text style={s.brandName}>Site Monitor</Text>
          <Text style={s.generated}>{t.generated(dates.generated(report.generatedAt))}</Text>
        </View>

        <Text style={s.title}>{subject ? `${t.title}: ${subject.name}` : t.title}</Text>
        <Text style={s.period}>{periodLabel}</Text>
        <Text style={s.scope}>
          {[
            subject ? subject.host : t.scopeAll(totals.monitors),
            t.timeZone(zoneLabel(report.timeZone, Date.parse(report.to))),
          ].join('   ·   ')}
        </Text>

        <Text style={s.summary}>{summary.join(' ')}</Text>

        <View style={s.kpis} wrap={false}>
          <Kpi
            label={t.kpi.availability}
            value={formatAvailability(totals.availability)}
            note={t.kpi.availabilityNote}
            color={availabilityColor(totals.availability)}
          />
          <Kpi
            divider
            label={t.kpi.incidents}
            value={number(totals.incidents)}
            note={single ? t.kpi.incidentsNoteSingle : t.kpi.incidentsNote(totals.affected, totals.monitors)}
          />
          <Kpi
            divider
            label={t.kpi.downtime}
            value={totals.downtimeMs ? span(totals.downtimeMs) : '0'}
            note={single ? t.kpi.downtimeNoteSingle : t.kpi.downtimeNote}
          />
          <Kpi divider label={t.kpi.mttr} value={span(totals.mttrMs)} note={t.kpi.mttrNote} />
        </View>

        <Section title={t.chart[report.unit]} note={t.chartNote[report.unit]}>
          <BucketChart report={report} axis={dates.axis} empty={t.noIncidents} />
        </Section>

        {!single && (
          <Section title={t.monitors} breakable>
            <MonitorTable report={report} />
          </Section>
        )}

        <Section title={t.timeline}>
          <Timeline report={report} axis={dates.axis} />
        </Section>

        {report.causes.length > 0 && (
          <Section title={t.causes}>
            <Causes report={report} />
          </Section>
        )}

        <Section title={t.log} breakable>
          {report.incidents.length === 0 ? (
            <Text style={s.empty}>{t.noIncidents}</Text>
          ) : (
            <IncidentLog report={report} stamp={dates.stamp} single={single} />
          )}
        </Section>

        <View style={s.method} wrap={false}>
          <Text>{t.method}</Text>
          {totals.checks > 0 && (
            <Text style={{ marginTop: 3 }}>
              {t.checks(number(totals.checks), number(totals.failedChecks))}
            </Text>
          )}
          {historyPartial && (
            <Text style={{ marginTop: 3 }}>{t.historyNote(dates.day(report.historyFrom!))}</Text>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text>{`${t.footer}, ${periodLabel}`}</Text>
          <Text
            style={{ marginLeft: 'auto' }}
            render={({ pageNumber, totalPages }) => t.page(pageNumber, totalPages)}
          />
        </View>

      </Page>
    </Document>
  )
}

function Kpi({
  label,
  value,
  note,
  color,
  divider,
}: {
  label: string
  value: string
  note: string
  color?: string
  divider?: boolean
}) {
  return (
    <View style={divider ? [s.kpi, s.kpiDivider] : s.kpi}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={color ? [s.kpiValue, { color }] : s.kpiValue}>{value}</Text>
      <Text style={s.kpiNote}>{note}</Text>
    </View>
  )
}

function Section({
  title,
  note,
  breakable,
  children,
}: {
  title: string
  note?: string
  /** Long sections may run onto the next page; short ones move there whole. */
  breakable?: boolean
  children: React.ReactNode
}) {
  return (
    <View style={s.section} wrap={breakable ?? false}>
      {/* Keeps the heading from being stranded at the bottom of a page. */}
      <View minPresenceAhead={60}>
        <Text style={s.sectionTitle}>{title}</Text>
        {note && <Text style={s.sectionNote}>{note}</Text>}
      </View>
      <View style={s.sectionBody}>{children}</View>
    </View>
  )
}

/** Axis labels spread along a track: at most `max`, placed by time. */
function AxisLabels({
  report,
  axis,
  max,
}: {
  report: Report
  axis: (iso: string, unit: ReportUnit) => string
  max: number
}) {
  const from = Date.parse(report.from)
  const length = Date.parse(report.to) - from
  const step = Math.max(1, Math.ceil(report.buckets.length / max))
  const ticks = report.buckets.filter((_, index) => index % step === 0)
  return (
    <View style={{ position: 'relative', height: 12, marginTop: 4 }}>
      {ticks.map((bucket) => {
        const at = Math.max(0, (Date.parse(bucket.start) - from) / length)
        if (at > 0.94) return null
        return (
          <Text
            key={bucket.start}
            style={{ position: 'absolute', left: `${at * 100}%`, width: 60, fontSize: 6.5, color: C.faint }}
          >
            {axis(bucket.start, report.unit)}
          </Text>
        )
      })}
    </View>
  )
}

const CHART_HEIGHT = 92

function BucketChart({
  report,
  axis,
  empty,
}: {
  report: Report
  axis: (iso: string, unit: ReportUnit) => string
  empty: string
}) {
  const max = report.buckets.reduce((top, bucket) => Math.max(top, bucket.incidents), 0)
  const dense = report.buckets.length > 36
  const gap = dense ? 0.6 : 1.5

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 16, height: CHART_HEIGHT, justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 6.5, color: C.faint }}>{max || ''}</Text>
          <Text style={{ fontSize: 6.5, color: C.faint }}>0</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View
            style={{
              height: CHART_HEIGHT,
              flexDirection: 'row',
              alignItems: 'flex-end',
              borderBottomWidth: 1,
              borderBottomColor: C.line,
              borderTopWidth: 0.5,
              borderTopColor: C.hairline,
            }}
          >
            {max === 0 ? (
              <Text style={{ width: '100%', marginBottom: CHART_HEIGHT / 2 - 6, textAlign: 'center', fontSize: 8, color: C.faint }}>
                {empty}
              </Text>
            ) : (
              report.buckets.map((bucket) => {
                const height = bucket.incidents ? Math.max(2, (bucket.incidents / max) * (CHART_HEIGHT - 12)) : 0
                return (
                  <View key={bucket.start} style={{ flex: 1, marginHorizontal: gap, alignItems: 'center' }}>
                    {!dense && bucket.incidents > 0 && (
                      <Text style={{ fontSize: 6, color: C.muted, marginBottom: 1.5 }}>{bucket.incidents}</Text>
                    )}
                    <View
                      style={{
                        width: '100%',
                        height,
                        backgroundColor: C.down,
                        borderTopLeftRadius: 1.5,
                        borderTopRightRadius: 1.5,
                      }}
                    />
                  </View>
                )
              })
            )}
          </View>
          <AxisLabels report={report} axis={axis} max={8} />
        </View>
      </View>
    </View>
  )
}

const COL = { availability: 64, incidents: 44, downtime: 62, longest: 62, response: 62 }

function MonitorTable({ report }: { report: Report }) {
  const t = T
  const span = (ms: number) => (ms ? formatSpan(ms) : '—')
  return (
    <View>
      <View style={s.tableHead} fixed>
        <Text style={[s.th, { flex: 1 }]}>{t.columns.monitor}</Text>
        <Text style={[s.th, s.num, { width: COL.availability }]}>{t.columns.availability}</Text>
        <Text style={[s.th, s.num, { width: COL.incidents }]}>{t.columns.incidents}</Text>
        <Text style={[s.th, s.num, { width: COL.downtime }]}>{t.columns.downtime}</Text>
        <Text style={[s.th, s.num, { width: COL.longest }]}>{t.columns.longest}</Text>
        <Text style={[s.th, s.num, { width: COL.response }]}>{t.columns.response}</Text>
      </View>
      {report.monitors.map((monitor) => {
        const quiet = monitor.incidents === 0
        return (
          <View key={monitor.id} style={s.tableRow} wrap={false}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.name}>
                {monitor.name}
                {!monitor.enabled && <Text style={{ fontWeight: 400, color: C.faint }}>{`  ${t.paused}`}</Text>}
              </Text>
              <Text style={s.host}>{monitor.host}</Text>
            </View>
            <Text
              style={[s.num, { width: COL.availability, fontWeight: 500, color: availabilityColor(monitor.availability) }]}
            >
              {formatAvailability(monitor.availability)}
            </Text>
            <Text style={[s.num, { width: COL.incidents, color: quiet ? C.faint : C.ink }]}>
              {monitor.incidents}
            </Text>
            <Text style={[s.num, { width: COL.downtime, color: quiet ? C.faint : C.text }]}>
              {span(monitor.downtimeMs)}
            </Text>
            <Text style={[s.num, { width: COL.longest, color: quiet ? C.faint : C.text }]}>
              {span(monitor.longestMs)}
            </Text>
            <Text style={[s.num, { width: COL.response, color: C.muted }]}>
              {monitor.avgResponseMs === null ? '—' : formatResponseTimeRu(monitor.avgResponseMs)}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const LANE_LABEL = 112

function Timeline({
  report,
  axis,
}: {
  report: Report
  axis: (iso: string, unit: ReportUnit) => string
}) {
  const from = Date.parse(report.from)
  const to = Date.parse(report.to)
  const length = to - from

  return (
    <View>
      {report.monitors.map((monitor) => {
        const own = report.incidents.filter((incident) => incident.monitorId === monitor.id)
        return (
          <View key={monitor.id} style={[s.row, { marginBottom: 4.5 }]} wrap={false}>
            <Text style={{ width: LANE_LABEL, paddingRight: 8, fontSize: 7.5, color: own.length ? C.ink : C.muted }}>
              {monitor.name}
            </Text>
            <View style={{ flex: 1, height: 9, borderRadius: 2, backgroundColor: C.panel, position: 'relative' }}>
              {own.map((incident) => {
                const start = Math.max(from, Date.parse(incident.startedAt))
                const end = Math.min(to, Date.parse(incident.startedAt) + incident.durationMs)
                const left = ((start - from) / length) * 100
                // Short outages would vanish at this scale; give each a sliver at least.
                const width = Math.max(0.35, ((end - start) / length) * 100)
                return (
                  <View
                    key={incident.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${Math.min(left, 100 - width)}%`,
                      width: `${width}%`,
                      backgroundColor: C.down,
                      borderRadius: 1,
                    }}
                  />
                )
              })}
            </View>
          </View>
        )
      })}
      <View style={{ marginLeft: LANE_LABEL }}>
        <AxisLabels report={report} axis={axis} max={7} />
      </View>
    </View>
  )
}

function Causes({ report }: { report: Report }) {
  const t = T
  const top = report.causes[0]?.incidents ?? 1
  return (
    <View>
      <View style={s.tableHead}>
        <Text style={[s.th, { flex: 1 }]}>{t.causeColumns.cause}</Text>
        <Text style={[s.th, s.num, { width: 44 }]}>{t.causeColumns.incidents}</Text>
        <Text style={[s.th, s.num, { width: 62 }]}>{t.causeColumns.downtime}</Text>
      </View>
      {report.causes.map((cause) => (
        <View key={cause.cause} style={s.tableRow} wrap={false}>
          <View style={[s.row, { flex: 1, paddingRight: 10 }]}>
            <Text style={{ flexShrink: 1, color: C.ink }}>{cause.cause}</Text>
            <View
              style={{
                marginLeft: 8,
                width: Math.max(2, (cause.incidents / top) * 90),
                height: 4,
                borderRadius: 1,
                backgroundColor: C.down,
                opacity: 0.8,
              }}
            />
          </View>
          <Text style={[s.num, { width: 44, color: C.ink }]}>{cause.incidents}</Text>
          <Text style={[s.num, { width: 62 }]}>{formatSpan(cause.downtimeMs)}</Text>
        </View>
      ))}
    </View>
  )
}

const LOG = { index: 20, monitor: 92, started: 62, ended: 66, duration: 58 }

function IncidentLog({
  report,
  stamp,
  single,
}: {
  report: Report
  stamp: (iso: string) => string
  single: boolean
}) {
  const t = T
  return (
    <View>
      <View style={s.tableHead} fixed>
        <Text style={[s.th, { width: LOG.index }]}>#</Text>
        {!single && <Text style={[s.th, { width: LOG.monitor }]}>{t.logColumns.monitor}</Text>}
        <Text style={[s.th, { width: LOG.started }]}>{t.logColumns.started}</Text>
        <Text style={[s.th, { width: LOG.ended }]}>{t.logColumns.ended}</Text>
        <Text style={[s.th, s.num, { width: LOG.duration, paddingRight: 12 }]}>{t.logColumns.duration}</Text>
        <Text style={[s.th, { flex: 1 }]}>{t.logColumns.cause}</Text>
      </View>
      {report.incidents.map((incident, index) => (
        <View key={incident.id} style={[s.tableRow, { alignItems: 'flex-start', fontSize: 8 }]} wrap={false}>
          <Text style={{ width: LOG.index, color: C.faint }}>{index + 1}</Text>
          {!single && (
            <Text style={{ width: LOG.monitor, paddingRight: 6, fontWeight: 500, color: C.ink }}>
              {incident.monitorName}
            </Text>
          )}
          <Text style={{ width: LOG.started }}>{stamp(incident.startedAt)}</Text>
          {incident.endedAt === null ? (
            <Text style={{ width: LOG.ended, fontWeight: 500, color: C.down }}>{t.ongoingLabel}</Text>
          ) : (
            <Text style={{ width: LOG.ended }}>{stamp(incident.endedAt)}</Text>
          )}
          <Text style={[s.num, { width: LOG.duration, paddingRight: 12, color: C.ink }]}>
            {formatSpan(incident.durationMs)}
          </Text>
          <Text style={{ flex: 1, color: C.muted }}>{incident.cause}</Text>
        </View>
      ))}
    </View>
  )
}
