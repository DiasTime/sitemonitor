import Link from 'next/link'
import { ArrowRight, Bell, GitBranch, Timer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'

const FEATURES = [
  {
    icon: Timer,
    title: 'Checks every ~3 minutes',
    body: 'A GitHub Actions workflow probes every site on a schedule. No server, no worker, nothing to keep running.',
  },
  {
    icon: Bell,
    title: 'Telegram alerts that stay quiet',
    body: 'One message when a site goes down and one when it comes back — not one every three minutes.',
  },
  {
    icon: GitBranch,
    title: 'Your repository is the database',
    body: 'Status, history and incidents live as JSON in Git. Readable, portable, and versioned by definition.',
  },
]

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-up" />
            <span className="text-sm font-semibold tracking-tight">Site Monitor</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
          <div className="container relative py-24 sm:py-32">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                Know when your website goes down.
              </h1>
              <p className="mx-auto mt-5 max-w-lg text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
                Monitor your websites automatically every 3 minutes.
              </p>
              <div className="mt-8 flex justify-center">
                <Button asChild size="lg">
                  <Link href="/dashboard">
                    Open Dashboard
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="container py-16 sm:py-20">
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-background p-6">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h2 className="mt-4 text-sm font-medium">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="container flex h-14 items-center justify-between text-xs text-muted-foreground">
          <span>Checks approximately every 3 minutes.</span>
          <span>GitHub Actions · Vercel · Telegram</span>
        </div>
      </footer>
    </div>
  )
}
