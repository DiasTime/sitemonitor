'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

import { useI18n } from '@/components/i18n/i18n-provider'
import { LanguageSwitch } from '@/components/i18n/language-switch'
import { Brand } from '@/components/ui/brand'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { cn } from '@/lib/cn'

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)

  async function signOut() {
    setPending(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.replace('/login')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  const onOverview = pathname === '/dashboard'

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" aria-label={t.header.dashboard}>
            <Brand />
          </Link>
          <nav aria-label={t.header.dashboard} className="hidden items-center sm:flex">
            <Link
              href="/dashboard"
              aria-current={onOverview ? 'page' : undefined}
              className={cn(
                'relative rounded-md px-3 py-1.5 text-sm transition-colors',
                onOverview
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {t.header.monitors}
              {onOverview && (
                <span className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-foreground" />
              )}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-1">
          {children}
          <LanguageSwitch className="mr-1" />
          <ThemeToggle />
          <Button variant="ghost" size="icon" aria-label={t.common.signOut} title={t.common.signOut} onClick={signOut} disabled={pending}>
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  )
}
