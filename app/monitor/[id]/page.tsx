import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { MonitorDetail } from '@/components/monitor/monitor-detail'
import { isValidMonitorId } from '@/lib/security'

export const metadata: Metadata = { title: 'Monitor' }

export default async function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidMonitorId(id)) notFound()

  return <MonitorDetail monitorId={id} />
}
