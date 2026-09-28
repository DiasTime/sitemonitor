import type { Metadata } from 'next'

import { DashboardClient } from '@/components/dashboard/dashboard-client'
import { getMessages } from '@/lib/i18n/messages'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: getMessages(await getLocale()).meta.dashboard }
}

export default function DashboardPage() {
  return <DashboardClient />
}
