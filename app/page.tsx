import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Globe,
  KeyRound,
  ShieldAlert,
} from 'lucide-react'

import { SAMPLE_MONITORS, SAMPLE_OUTAGE } from '@/components/marketing/sample'
import { Brand } from '@/components/ui/brand'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { UptimeBars } from '@/components/ui/uptime-bars'
import { LanguageSwitch } from '@/components/i18n/language-switch'
import { createFormatters, type Formatters } from '@/lib/i18n/format'
import { getMessages, type Messages } from '@/lib/i18n/messages'
import { getLocale } from '@/lib/i18n/server'

const STACK = [
  { slug: 'githubactions', name: 'GitHub Actions' },
  { slug: 'vercel', name: 'Vercel' },
  { slug: 'telegram', name: 'Telegram' },
  { slug: 'nextdotjs', name: 'Next.js' },
  { slug: 'git', name: 'Git' },
]

const STATUS_JSON = `{
  "id": "storefront",
  "status": "UP",
  "statusCode": 200,
  "responseTime": 184,
  "uptime30d": 99.97,
  "incidents": 1
}`

export default async function LandingPage() {
  const locale = await getLocale()
  const t = getMessages(locale)
  const format = createFormatters(locale)
  const l = t.landing

  return (
    <div className="grain flex min-h-[100dvh] flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        {t.common.skipToContent}
      </a>

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl">
        <nav className="container flex h-16 items-center justify-between gap-6" aria-label="Main">
          <Link href="/" aria-label={t.common.home}>
            <Brand />
          </Link>
          <div className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              {l.navFeatures}
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              {l.navHow}
            </a>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitch className="mr-1" />
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href="/dashboard">{t.common.openDashboard}</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="line-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_70%_30%,black,transparent_75%)]" />
          <div className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full bg-up/10 blur-[120px]" />

          <div className="container relative grid items-center gap-14 pb-20 pt-16 md:pb-28 md:pt-24 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <div className="max-w-xl">
              <p className="reveal inline-flex items-center gap-2 rounded-md border border-border bg-card/60 px-2.5 py-1 text-xs font-medium text-muted-foreground" style={{ ['--i' as string]: 0 }}>
                <Activity className="h-3.5 w-3.5 text-up" />
                {l.pill}
              </p>
              <h1
                className="reveal mt-6 text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl"
                style={{ ['--i' as string]: 1 }}
              >
                {l.title}
              </h1>
              <p
                className="reveal mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground"
                style={{ ['--i' as string]: 2 }}
              >
                {l.subtitle}
              </p>
              <div className="reveal mt-9 flex flex-wrap items-center gap-5" style={{ ['--i' as string]: 3 }}>
                <Button asChild size="lg" className="group">
                  <Link href="/dashboard">
                    {t.common.openDashboard}
                    <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <a
                  href="#how"
                  className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {l.seeHow}
                </a>
              </div>
            </div>

            <HeroPreview t={t.landing.preview} bars={t.bars} format={format} />
          </div>
        </section>

        {/* Stack */}
        <section aria-label={l.stackLabel} className="border-y border-border/70 bg-card/40">
          <div className="container flex flex-col items-center gap-6 py-9 md:flex-row md:justify-between">
            <p className="text-sm text-muted-foreground">{l.stackLabel}</p>
            <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
              {STACK.map(({ slug, name }) => (
                <li key={slug}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://cdn.simpleicons.org/${slug}/52525b`}
                    alt={name}
                    width={24}
                    height={24}
                    loading="lazy"
                    className="h-6 w-6 opacity-70 transition-opacity hover:opacity-100 dark:invert"
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Features bento */}
        <section id="features" className="container scroll-mt-20 py-24 md:py-32">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.03em] md:text-5xl md:leading-[1.05]">
            {l.featuresTitle}
          </h2>

          <div className="mt-14 grid gap-4 md:grid-cols-6">
            <article className="reveal-on-scroll relative overflow-hidden rounded-xl border border-border bg-card p-7 shadow-panel md:col-span-4 md:p-9">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-up/[0.07] to-transparent" />
              <BellRing className="h-5 w-5 text-up" />
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{l.alertsTitle}</h3>
              <p className="mt-2 max-w-[52ch] text-muted-foreground">
                {l.alertsBody}
              </p>
              <div className="relative mt-10">
                <UptimeBars buckets={SAMPLE_OUTAGE} className="h-12" t={t.bars} />
                <div className="relative mt-2 h-10 font-mono text-[11px]">
                  {/* Bars 15 and 18 of 24: where the outage starts and where it clears. */}
                  <span className="absolute top-0 flex -translate-x-full flex-col items-end text-down" style={{ left: `${(15 / 24) * 100}%` }}>
                    <span className="h-3 w-px bg-down" />
                    <span className="mt-1 whitespace-nowrap">{l.alertSent}</span>
                  </span>
                  <span className="absolute top-0 flex flex-col items-start text-up" style={{ left: `${(18 / 24) * 100}%` }}>
                    <span className="h-3 w-px bg-up" />
                    <span className="mt-1 whitespace-nowrap">{l.recovered}</span>
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/80">{l.sampleOutage}</p>
              </div>
            </article>

            <article className="reveal-on-scroll rounded-xl border border-border bg-card p-7 shadow-panel md:col-span-2 md:p-8">
              <h3 className="text-xl font-semibold tracking-tight">{l.kindsTitle}</h3>
              <ul className="mt-6 space-y-5">
                {[Globe, Activity, KeyRound].map((icon, index) => ({ icon, ...l.kinds[index] })).map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-3.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            <article className="reveal-on-scroll relative overflow-hidden rounded-xl border border-checking/25 bg-checking/[0.06] p-7 md:col-span-2 md:p-8">
              <ShieldAlert className="h-5 w-5 text-checking" />
              <p className="mt-6 text-5xl font-semibold tracking-[-0.04em] tabular">{l.sslValue}</p>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{l.sslTitle}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {l.sslBody}
              </p>
            </article>

            <article className="reveal-on-scroll rounded-xl border border-border bg-card p-7 shadow-panel md:col-span-2 md:p-8">
              <h3 className="text-lg font-semibold tracking-tight">{l.cadenceTitle}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {l.cadenceBody}
              </p>
              {/* Four hours of ticks at :07, :27 and :47; one per hour becomes the run. */}
              <div className="mt-8 grid grid-cols-4 gap-2" aria-hidden>
                {[0, 2, 1, 0].map((served, hour) => (
                  <div key={hour} className="flex items-end gap-1 border-l border-border pl-2">
                    {[0, 1, 2].map((tick) => (
                      <span
                        key={tick}
                        className={`w-full rounded-sm ${
                          tick === served ? 'h-8 bg-foreground/80' : 'h-3 bg-muted-foreground/20'
                        }`}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>14:00</span>
                <span>18:00</span>
              </div>
              <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-1.5 rounded-sm bg-foreground/80" />
                  {l.cadenceRun}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-sm bg-muted-foreground/30" />
                  {l.cadenceSkipped}
                </span>
              </div>
            </article>

            <article className="reveal-on-scroll overflow-hidden rounded-xl border border-border bg-[hsl(240_8%_8%)] text-zinc-100 md:col-span-2">
              <div className="p-7 pb-0 md:p-8 md:pb-0">
                <h3 className="text-lg font-semibold tracking-tight">{l.repoTitle}</h3>
                <p className="mt-1.5 text-sm text-zinc-400">
                  {l.repoBody}
                </p>
              </div>
              <pre className="mt-6 overflow-x-auto border-t border-white/10 bg-black/20 px-7 py-5 font-mono text-[12px] leading-relaxed text-zinc-300 md:px-8">
                <code>{STATUS_JSON}</code>
              </pre>
            </article>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-border/70 bg-card/40">
          <div className="container py-24 md:py-32">
            <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.03em] md:text-5xl md:leading-[1.05]">
              {l.howTitle}
            </h2>

            <ol className="relative mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
              <span
                aria-hidden
                className="absolute left-0 right-0 top-[15px] hidden h-px bg-gradient-to-r from-border via-foreground/20 to-border md:block"
              />
              {l.steps.map((step, index) => (
                <li key={step.title} className="reveal-on-scroll relative">
                  <span className="relative flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background font-mono text-xs text-muted-foreground shadow-panel">
                    {index + 1}
                  </span>
                  <h3 className="mt-6 text-lg font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-2 max-w-[36ch] text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="relative overflow-hidden border-t border-border/70">
          <div className="pointer-events-none absolute left-1/2 top-full h-[420px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-up/15 blur-[120px]" />
          <div className="container relative flex flex-col items-start gap-8 py-24 md:flex-row md:items-end md:justify-between md:py-32">
            <h2 className="max-w-2xl text-4xl font-semibold tracking-[-0.035em] md:text-6xl md:leading-[1.02]">
              {l.closingTitle}
            </h2>
            <Button asChild size="lg" className="group shrink-0">
              <Link href="/dashboard">
                {t.common.openDashboard}
                <ArrowUpRight className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="container flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Brand className="text-foreground" />
          <p>{l.footer}</p>
        </div>
      </footer>
    </div>
  )
}

/** The hero visual: the real uptime-bar component, fed with labelled sample data. */
function HeroPreview({
  t,
  bars,
  format,
}: {
  t: Messages['landing']['preview']
  bars: Messages['bars']
  format: Formatters
}) {
  const down = SAMPLE_MONITORS.filter((monitor) => monitor.status === 'DOWN').length

  return (
    <div className="reveal relative" style={{ ['--i' as string]: 2 }}>
      <div className="absolute -inset-px rounded-[18px] bg-gradient-to-b from-foreground/10 to-transparent" aria-hidden />
      <figure className="relative overflow-hidden rounded-xl border border-border bg-card shadow-panel">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <StatusDot status={down ? 'DOWN' : 'UP'} />
            <span className="text-sm font-medium">
              {down ? t.someDown(down, SAMPLE_MONITORS.length) : t.allOperational}
            </span>
          </div>
          <span className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            {t.sampleData}
          </span>
        </div>

        <ul className="divide-y divide-border">
          {SAMPLE_MONITORS.map((monitor) => (
            <li key={monitor.name} className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusDot status={monitor.status} size="sm" />
                  <span className="truncate text-sm font-medium">{monitor.name}</span>
                  <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
                    {monitor.host}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-4 font-mono text-xs tabular">
                  <span className="hidden text-muted-foreground sm:inline">{format.responseTime(monitor.response)}</span>
                  <span className={monitor.status === 'DOWN' ? 'text-down' : ''}>{format.uptime(monitor.uptime)}</span>
                </div>
              </div>
              <UptimeBars buckets={monitor.buckets} className="mt-3 h-6" t={bars} />
            </li>
          ))}
        </ul>

        <div className="relative flex items-center justify-between overflow-hidden border-t border-border bg-muted/40 px-5 py-3 font-mono text-[11px] text-muted-foreground">
          <span>{t.lastChecks}</span>
          <span>{t.checkingNow}</span>
          <span className="animate-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-up/10 to-transparent" />
        </div>
        <figcaption className="sr-only">
          {t.caption}
        </figcaption>
      </figure>
    </div>
  )
}
