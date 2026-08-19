'use client'

import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = 'site-monitor-theme'

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

/**
 * Inlined in <head> so the correct theme is applied before first paint.
 * Kept in sync with the provider below.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('system')
  const [resolved, setResolved] = React.useState<'light' | 'dark'>('light')

  const apply = React.useCallback((next: Theme) => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const dark = next === 'dark' || (next === 'system' && media.matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    setResolved(dark ? 'dark' : 'light')
  }, [])

  React.useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system'
    setThemeState(stored)
    apply(stored)

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) as Theme | null) === 'dark') return
      if ((localStorage.getItem(STORAGE_KEY) as Theme | null) === 'light') return
      apply('system')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [apply])

  const setTheme = React.useCallback(
    (next: Theme) => {
      localStorage.setItem(STORAGE_KEY, next)
      setThemeState(next)
      apply(next)
    },
    [apply],
  )

  const value = React.useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}
