import type { Metadata, Viewport } from 'next'

import { ThemeProvider, themeInitScript } from '@/components/ui/theme-provider'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Site Monitor',
    template: '%s · Site Monitor',
  },
  description:
    'Know when your website goes down. Automatic uptime checks approximately every 3 minutes, with Telegram alerts.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
