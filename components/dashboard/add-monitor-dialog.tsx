'use client'

import * as React from 'react'
import { Activity, Loader2, Plus, X } from 'lucide-react'

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

export function AddMonitorDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [name, setName] = React.useState('')
  const [healthUrl, setHealthUrl] = React.useState('')
  const [healthOpen, setHealthOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  function reset() {
    setUrl('')
    setName('')
    setHealthUrl('')
    setHealthOpen(false)
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
        body: JSON.stringify({
          url,
          name: name.trim() || undefined,
          healthUrl: healthOpen ? healthUrl.trim() || undefined : undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Could not add the website')
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
          Add website
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add website</DialogTitle>
          <DialogDescription>
            The next monitoring run picks it up — usually within a few minutes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Website URL</Label>
            <Input
              id="url"
              type="url"
              inputMode="url"
              required
              autoFocus
              maxLength={2048}
              placeholder="https://example.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Website name</Label>
            <Input
              id="name"
              maxLength={80}
              placeholder="Example Website"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional — the hostname is used when left empty.
            </p>
          </div>

          {healthOpen ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="healthUrl" className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Health endpoint
                </Label>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Remove health endpoint"
                  onClick={() => {
                    setHealthOpen(false)
                    setHealthUrl('')
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                id="healthUrl"
                type="url"
                inputMode="url"
                autoFocus
                maxLength={2048}
                placeholder="https://example.com/api/health"
                value={healthUrl}
                onChange={(event) => setHealthUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Checked on every run. If it answers JSON with a{' '}
                <code className="font-mono">status</code> field, that field must report{' '}
                <code className="font-mono">ok</code> — otherwise the site counts as down even
                on HTTP 200.
              </p>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setHealthOpen(true)}
            >
              <Plus />
              Add health endpoint
            </Button>
          )}

          {error && (
            <p role="alert" className="text-sm text-down">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !url}>
              {pending && <Loader2 className="animate-spin" />}
              Add website
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
