'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const router = useRouter()
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

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-up" />
          <span className="text-sm font-semibold tracking-tight">Site Monitor</span>
        </Link>

        <div className="flex items-center gap-1">
          {children}
          <ThemeToggle />
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut} disabled={pending}>
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  )
}
