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
  login: {
    tab: 'Portal login',
    title: 'Add portal login check',
    description:
      'Signs into the portal on every run instead of just loading the page, so a broken login counts as down. ' +
      'The credentials themselves are never entered here — add them as the PORTAL_CREDENTIALS secret, keyed by this monitor’s id (see the README).',
    urlLabel: 'Login page URL',
    urlPlaceholder: 'https://portal.example.com/login',
    namePlaceholder: 'Example Portal',
    hint: 'Fetches this page, submits the sign-in form with the configured credentials, and checks the result.',
    submit: 'Add login check',
  },
}

export function AddMonitorDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState<MonitorType>('website')
  const [url, setUrl] = React.useState('')
  const [name, setName] = React.useState('')
  const [loginUrl, setLoginUrl] = React.useState('')
  const [loginBodyType, setLoginBodyType] = React.useState<'form' | 'json'>('form')
  const [usernameField, setUsernameField] = React.useState('')
  const [passwordField, setPasswordField] = React.useState('')
  const [successText, setSuccessText] = React.useState('')
  const [failureText, setFailureText] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const copy = COPY[type]

  function reset() {
    setType('website')
    setUrl('')
    setName('')
    setLoginUrl('')
    setLoginBodyType('form')
    setUsernameField('')
    setPasswordField('')
    setSuccessText('')
    setFailureText('')
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
          type,
          ...(type === 'login'
            ? {
                loginUrl: loginUrl.trim() || undefined,
                loginBodyType: loginBodyType === 'json' ? 'json' : undefined,
                usernameField: usernameField.trim() || undefined,
                passwordField: passwordField.trim() || undefined,
                successText: successText.trim() || undefined,
                failureText: failureText.trim() || undefined,
              }
            : {}),
        }),
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

          {type === 'login' && (
            <div className="space-y-4 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Advanced — optional, defaults work for a plain HTML sign-in form.
              </p>

              <div className="space-y-2">
                <Label htmlFor="loginUrl">Form target URL</Label>
                <Input
                  id="loginUrl"
                  type="url"
                  inputMode="url"
                  maxLength={2048}
                  placeholder="Defaults to the login page URL above"
                  value={loginUrl}
                  onChange={(event) => setLoginUrl(event.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={loginBodyType === 'json'}
                  onChange={(event) => setLoginBodyType(event.target.checked ? 'json' : 'form')}
                />
                Send credentials as a JSON body instead of a form
              </label>
              <p className="-mt-2 text-xs text-muted-foreground">
                For an API-driven sign-in (a single-page app posting JSON), not a plain HTML form.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="usernameField">Username field name</Label>
                  <Input
                    id="usernameField"
                    maxLength={64}
                    placeholder="username"
                    value={usernameField}
                    onChange={(event) => setUsernameField(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passwordField">Password field name</Label>
                  <Input
                    id="passwordField"
                    maxLength={64}
                    placeholder="password"
                    value={passwordField}
                    onChange={(event) => setPasswordField(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="successText">Success text</Label>
                <Input
                  id="successText"
                  maxLength={200}
                  placeholder="Text that only appears once signed in"
                  value={successText}
                  onChange={(event) => setSuccessText(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="failureText">Failure text</Label>
                <Input
                  id="failureText"
                  maxLength={200}
                  placeholder="Text that only appears when sign-in fails"
                  value={failureText}
                  onChange={(event) => setFailureText(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Without either, a login counts as successful once the sign-in form is no longer
                  shown back to it.
                </p>
              </div>
            </div>
          )}

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
