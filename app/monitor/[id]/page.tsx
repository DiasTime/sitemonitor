import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { MonitorDetail } from '@/components/monitor/monitor-detail'
import { isValidMonitorId } from '@/lib/security'
import { getMessages } from '@/lib/i18n/messages'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: getMessages(await getLocale()).meta.monitor }
}

export default async function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidMonitorId(id)) notFound()

  return <MonitorDetail monitorId={id} />
}
