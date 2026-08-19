'use client'

import * as React from 'react'
import { Loader2, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MonitorType } from '@/lib/types'

/** Wording differs per kind, everything else about the form is identical. */
const COPY: Record<MonitorType, {
  tab: string
  title: string
  description: string
  urlLabel: string
  urlPlaceholder: string
  namePlaceholder: string
  hint: string
  submit: string
}> = {
  website: {
    tab: 'Website',
    title: 'Add website',
    description: 'The next monitoring run picks it up — usually within a few minutes.',
    urlLabel: 'Website URL',
    urlPlaceholder: 'https://example.com',
    namePlaceholder: 'Example Website',
    hint: 'Up when the page answers with an HTTP status of 200–399.',
    submit: 'Add website',
  },
  health: {
    tab: 'Health endpoint',
    title: 'Add health endpoint',
    description: 'The next monitoring run picks it up — usually within a few minutes.',
    urlLabel: 'Health endpoint URL',
    urlPlaceholder: 'https://example.com/api/health',
    namePlaceholder: 'Example API health',
    hint: 'If it answers JSON with a "status" field, that field must report ok — otherwise the check fails even on HTTP 200.',
    submit: 'Add health endpoint',
  },
}

export function AddMonitorDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState<MonitorType>('website')
  const [url, setUrl] = React.useState('')
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const copy = COPY[type]

  function reset() {
    setType('website')
    setUrl('')
    setName('')
    setError(null)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const response = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name: name.trim() || undefined, type }),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Could not add the monitor')
        return
      }

      reset()
      setOpen(false)
      onAdded()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          Add monitor
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={type}
          onValueChange={(value) => {
            setType(value as MonitorType)
            setError(null)
          }}
        >
          <TabsList className="w-full">
            {(Object.keys(COPY) as MonitorType[]).map((key) => (
              <TabsTrigger key={key} value={key} className="flex-1">
                {COPY[key].tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">{copy.urlLabel}</Label>
            <Input
              id="url"
              type="url"
              inputMode="url"
              required
              autoFocus
              maxLength={2048}
              placeholder={copy.urlPlaceholder}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{copy.hint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              maxLength={80}
              placeholder={copy.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional — the hostname is used when left empty.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-down">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !url}>
              {pending && <Loader2 className="animate-spin" />}
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
