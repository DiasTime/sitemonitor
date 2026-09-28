import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoginForm } from '@/components/dashboard/login-form'
import { LanguageSwitch } from '@/components/i18n/language-switch'
import { Brand } from '@/components/ui/brand'
import { Skeleton } from '@/components/ui/skeleton'
import { getMessages } from '@/lib/i18n/messages'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: getMessages(await getLocale()).meta.signIn }
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center px-6 py-16">
      <LanguageSwitch className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
