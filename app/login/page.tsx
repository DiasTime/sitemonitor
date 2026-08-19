import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoginForm } from '@/components/dashboard/login-form'
import { Skeleton } from '@/components/ui/skeleton'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-up" />
          <span className="text-sm font-semibold tracking-tight">Site Monitor</span>
        </div>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
