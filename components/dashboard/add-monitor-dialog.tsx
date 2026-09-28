'use client'

import * as React from 'react'
import { Loader2, Plus } from 'lucide-react'

import { useI18n } from '@/components/i18n/i18n-provider'
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
import type { Monitor, MonitorType } from '@/lib/types'

const KINDS: MonitorType[] = ['website', 'health', 'login']

export function AddMonitorDialog({ onAdded }: { onAdded: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  return (
    <MonitorDialog
      open={open}
      onOpenChange={setOpen}
      onSaved={onAdded}
      trigger={
        <Button size="sm">
          <Plus />
          {t.dialog.addMonitor}
        </Button>
      }
    />
  )
}

/** The add form, prefilled with `monitor` and saved back to it in place. */
export function EditMonitorDialog({
  monitor,
  open,
  onOpenChange,
  onSaved,
}: {
  monitor: Monitor
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return <MonitorDialog monitor={monitor} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
}

function MonitorDialog({
  monitor,
  open,
  onOpenChange,
  onSaved,
  trigger,
}: {
  /** Set when editing. */
  monitor?: Monitor
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  trigger?: React.ReactNode
}) {
  const { t: messages } = useI18n()
  const t = messages.dialog
  const editing = monitor !== undefined
  const [type, setType] = React.useState<MonitorType>('website')
  const [url, setUrl] = React.useState('')
  const [name, setName] = React.useState('')
  const [loginUrl, setLoginUrl] = React.useState('')
  const [loginBodyType, setLoginBodyType] = React.useState<'form' | 'json'>('form')
  const [usernameField, setUsernameField] = React.useState('')
  const [passwordField, setPasswordField] = React.useState('')
  const [successText, setSuccessText] = React.useState('')
  const [failureText, setFailureText] = React.useState('')
  const [sslExpiresAt, setSslExpiresAt] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  // Wording differs per kind, everything else about the form is identical.
  const copy = t.kinds[type]

  /** Back to an empty form, or to the monitor's saved values when editing. */
  const reset = React.useCallback(() => {
    setType(monitor?.type ?? 'website')
    setUrl(monitor?.url ?? '')
    setName(monitor?.name ?? '')
    setLoginUrl(monitor?.loginUrl ?? '')
    setLoginBodyType(monitor?.loginBodyType ?? 'form')
    setUsernameField(monitor?.usernameField ?? '')
    setPasswordField(monitor?.passwordField ?? '')
    setSuccessText(monitor?.successText ?? '')
    setFailureText(monitor?.failureText ?? '')
    setSslExpiresAt(monitor?.sslExpiresAt ?? '')
    setError(null)
  }, [monitor])

  // Load the latest saved values each time the edit form opens.
  React.useEffect(() => {
    if (open && editing) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const response = await fetch(monitor ? `/api/monitors/${monitor.id}` : '/api/monitors', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          name: name.trim() || undefined,
          type,
          // Always sent, so clearing the field in the edit form clears the date.
          sslExpiresAt,
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
        setError(
          typeof body?.error === 'string'
            ? body.error
            : editing
              ? t.saveError
              : t.addError,
        )
        return
      }

      reset()
      onOpenChange(false)
      onSaved()
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
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{monitor ? t.editTitle(monitor.name) : copy.title}</DialogTitle>
          <DialogDescription>
            {monitor
              ? type === 'login'
                ? t.editLoginDescription(monitor.id)
                : t.editDescription
              : copy.description}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={type}
          onValueChange={(value) => {
            setType(value as MonitorType)
            setError(null)
          }}
        >
          <TabsList className="w-full">
            {KINDS.map((key) => (
              <TabsTrigger key={key} value={key} className="flex-1">
                {t.kinds[key].tab}
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
            <Label htmlFor="name">{t.name}</Label>
            <Input
              id="name"
              maxLength={80}
              placeholder={copy.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.nameHint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sslExpiresAt">{t.sslLabel}</Label>
            <Input
              id="sslExpiresAt"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              className="w-full sm:w-48 [color-scheme:light] dark:[color-scheme:dark]"
              value={sslExpiresAt}
              onChange={(event) => setSslExpiresAt(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.sslHint}
            </p>
          </div>

          {type === 'login' && (
            <div className="space-y-4 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                {t.advanced}
              </p>

              <div className="space-y-2">
                <Label htmlFor="loginUrl">{t.loginUrl}</Label>
                <Input
                  id="loginUrl"
                  type="url"
                  inputMode="url"
                  maxLength={2048}
                  placeholder={t.loginUrlPlaceholder}
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
                {t.jsonBody}
              </label>
              <p className="-mt-2 text-xs text-muted-foreground">
                {t.jsonBodyHint}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="usernameField">{t.usernameField}</Label>
                  <Input
                    id="usernameField"
                    maxLength={64}
                    placeholder="username"
                    value={usernameField}
                    onChange={(event) => setUsernameField(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passwordField">{t.passwordField}</Label>
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
                <Label htmlFor="successText">{t.successText}</Label>
                <Input
                  id="successText"
                  maxLength={200}
                  placeholder={t.successPlaceholder}
                  value={successText}
                  onChange={(event) => setSuccessText(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="failureText">{t.failureText}</Label>
                <Input
                  id="failureText"
                  maxLength={200}
                  placeholder={t.failurePlaceholder}
                  value={failureText}
                  onChange={(event) => setFailureText(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t.textHint}
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
              {editing ? t.save : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
