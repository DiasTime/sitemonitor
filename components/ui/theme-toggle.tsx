'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/ui/theme-provider'

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
    >
      {mounted && resolved === 'dark' ? <Moon /> : <Sun />}
    </Button>
  )
}
