# Site Monitor

Website uptime monitoring with no database, no server and no worker.

GitHub Actions runs the checks, the repository stores the data as JSON, Telegram
delivers the alerts, and Vercel serves the dashboard.

```text
             ┌──────────────┐
             │   GitHub     │
             │              │
             │   JSON data  │
             │      +       │
             │    Actions   │
             └──────┬───────┘
                    │
          every ~3 minutes
                    │
                    ↓
          ┌─────────────────┐
          │ monitor.ts      │
          │                 │
          │ check websites  │
          │ save status     │
          │ detect outages  │
          └───────┬─────────┘
                  │
             ┌────┴─────┐
             ↓          ↓
          Telegram    GitHub
          notify       data
                         │
                         ↓
                     Vercel
                         │
                         ↓
                    Dashboard
```

---

## Contents

1. [What you get](#1-what-you-get)
2. [Create the GitHub repository](#2-create-the-github-repository)
3. [Create a Telegram bot](#3-create-a-telegram-bot)
4. [Add the GitHub Actions secrets](#4-add-the-github-actions-secrets)
5. [Create a GitHub token for the dashboard](#5-create-a-github-token-for-the-dashboard)
6. [Deploy to Vercel](#6-deploy-to-vercel)
7. [First run](#7-first-run)
8. [How it works](#8-how-it-works)
9. [Data files](#9-data-files)
10. [Alerting rules](#10-alerting-rules)
    - [Health endpoints](#health-endpoints)
    - [Portal login checks](#portal-login-checks)
    - [Who receives alerts](#who-receives-alerts)
    - [Talking to the bot](#talking-to-the-bot)
    - [Running a check by hand](#running-a-check-by-hand)
    - [Why the schedule is hourly](#why-the-schedule-is-hourly)
    - [The heartbeat endpoint](#the-heartbeat-endpoint)
11. [Why it does not commit on every check](#11-why-it-does-not-commit-on-every-check)
12. [Security](#12-security)
13. [Configuration reference](#13-configuration-reference)
14. [Limits and honest caveats](#14-limits-and-honest-caveats)
15. [Local development](#15-local-development)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. What you get

- **Dashboard** — monitor count, online/down counts, 30-day uptime, per-site
  cards with response time, uptime, last check and incident count.
- **Monitor page** — `/monitor/[id]` with uptime, average response, total
  checks, incidents, a 24H/7D/30D response-time chart, the recent check history
  and the incident log.
- **Add / pause / delete monitors** from the UI. Changes are written straight
  into `data/monitors.json` through the GitHub API.
- **Run check** button — probe everything now instead of waiting for the
  schedule. It starts the same workflow, so a manual run behaves exactly like a
  scheduled one, alerts included.
- **Three kinds of monitor** — a *website*, judged by its HTTP status code; a
  *health endpoint*, whose JSON body is inspected too, so an endpoint answering
  HTTP 200 while reporting trouble counts as down; or a *portal login check*,
  which actually signs into the platform with real credentials and counts it
  down when the sign-in itself fails, not just when the page fails to load.
  Pick the kind in the add dialog; each is an independent monitor.
- **Telegram alerts** on the transitions only: one message when a site goes
  down, one when it comes back — delivered to **everyone who sent `/start`** to
  the bot, not just one chat.
- **No database, no VPS, no Docker, no cron service, no worker.**

---

## 2. Create the GitHub repository

Create a new repository (public or private — both work) and push this project
into it:

```bash
git init
git add .
git commit -m "Initial Site Monitor"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

That is all the setup the monitoring side needs — the workflow in
`.github/workflows/monitor.yml` starts running on its own schedule.

> **Note:** GitHub disables scheduled workflows on repositories with no activity
> for 60 days. Any commit re-enables them.

---

## 3. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`.
2. Follow the prompts. BotFather replies with a token that looks like
   `123456789:AAE...`. That is your `TELEGRAM_BOT_TOKEN`.
3. Open your new bot in Telegram and send it **`/start`**. That is all — the
   next monitoring run notices you and starts sending you alerts. Anyone else
   who needs alerts does the same; see
   [who receives alerts](#who-receives-alerts).

`TELEGRAM_CHAT_ID` is optional. Set it if you want one chat wired in from the
first run, before anybody has sent `/start` — find the id by opening
`https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser after
messaging the bot, and look for `"chat":{"id":123456789`. Group ids are
negative; include the minus sign.

Telegram as a whole is optional. Without a token the monitoring still runs and
records everything; it just does not send messages.

---

## 4. Add the GitHub Actions secrets

In your repository: **Settings → Secrets and variables → Actions → New
repository secret**.

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | The token from BotFather |
| `TELEGRAM_CHAT_ID` | Optional. A chat wired in from the start, without `/start` |
| `TELEGRAM_SUBSCRIBE_PASSWORD` | Optional. Requires `/start <passphrase>` to subscribe |
| `PORTAL_CREDENTIALS` | Optional. Only needed for `login` monitors — see [Portal login checks](#portal-login-checks) |

You do **not** need to add a GitHub token here. The workflow uses the built-in
`GITHUB_TOKEN` that Actions provides automatically, and it already declares the
`contents: write` permission it needs to commit results.

While you are in that screen, check **Settings → Actions → General → Workflow
permissions** and make sure it is set to *Read and write permissions*.

---

## 5. Create a GitHub token for the dashboard

The Vercel deployment needs its own token to read and write the JSON files.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → pick this repository.
3. **Permissions → Repository permissions → Contents:** *Read and write*.
4. Generate it and copy the token — it is shown only once.

A classic token with the `repo` scope also works, but a fine-grained token
scoped to this one repository is much safer.

---

## 6. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub
   repository. Vercel detects Next.js on its own — leave the build settings
   alone.
2. Add these **Environment Variables** (all four are required):

   | Variable | Value |
   | --- | --- |
   | `GITHUB_TOKEN` | The fine-grained token from step 5 |
   | `GITHUB_OWNER` | Your GitHub username or organisation |
   | `GITHUB_REPO` | The repository name, e.g. `sitemonitor` |
   | `ADMIN_PASSWORD` | The password you will use to sign in |

   Optional: `GITHUB_BRANCH` (defaults to `main`), `SESSION_SECRET`,
   `DATA_CACHE_TTL_SECONDS`. See [`.env.example`](.env.example).

   None of these are prefixed `NEXT_PUBLIC_`, so none of them ever reach the
   browser.

3. Press **Deploy**.
4. Open `https://your-project.vercel.app` and click **Open Dashboard**. Sign in
   with `ADMIN_PASSWORD`.

> After changing an environment variable in Vercel you have to **redeploy** for
> it to take effect.

---

## 7. First run

The schedule fires on its own, but you can trigger the first check immediately:

**GitHub → Actions → Website Monitor → Run workflow.**

On that first run the script will:

- read `data/monitors.json`;
- check every enabled site;
- write `data/status.json`, `data/history.json` and `data/incidents.json`;
- send a Telegram message only if a site is actually down;
- commit the results back to the repository.

The repository ships with one example monitor (`https://example.com`) so the
first run has something to do. Delete it from the dashboard once you have added
your own sites.

---

## 8. How it works

**Monitoring — `scripts/monitor.ts`, run by `.github/workflows/monitor.yml`.**

The schedule asks for a run three times an hour, at `:07`, `:27` and `:47`, and
the run itself decides whether it is due: anything that lands less than
`MIN_GAP_MINUTES` (45 by default) after the last recorded check exits straight
away. GitHub serves only part of what a cron asks for, so asking three times is
what it takes to get one real run an hour — see
[why the schedule is hourly](#why-the-schedule-is-hourly). It can also be
started by hand with `workflow_dispatch`. Each pass:

1. checks out the repository and installs dependencies;
2. reads `data/monitors.json`;
3. probes every enabled site over HTTP(S) with a 10 second timeout, up to 8 at a
   time, measuring the time to the first response byte;
4. classifies the result — **200–399 is UP** (so 301 and 302 count as healthy),
   **400–599, timeouts, DNS failures, connection errors and TLS errors are
   DOWN**;
5. compares against the previous status and opens or closes an incident on a
   transition;
6. sends a Telegram message on that transition — and only then;
7. writes the JSON files back, and commits and pushes them itself when the state
   changed, so an outage found in minute 2 reaches the dashboard immediately
   rather than when the run ends.

A `concurrency` group named `website-monitor` with `cancel-in-progress: false`
guarantees that two runs never write the JSON files at the same time.

**Dashboard — Next.js on Vercel.**

Server-side route handlers read the JSON through the GitHub Contents API and
cache each file in memory for 20 seconds, so dashboard polling does not turn
into one API call per visitor:

| Route | Returns |
| --- | --- |
| `GET /api/monitors` | The configured sites |
| `POST /api/monitors` | Adds a site |
| `PATCH /api/monitors/:id` | Pauses or resumes a site |
| `DELETE /api/monitors/:id` | Removes a site |
| `GET /api/status` | Current state of every monitor |
| `GET /api/history` | Check samples (`?monitorId=&range=24h\|7d\|30d&limit=`) |
| `GET /api/incidents` | Incidents (`?monitorId=`) |
| `POST /api/check` | Starts a monitoring run now (the **Run check** button) |

The dashboard polls `/api/status` every 30 seconds and updates in place — no
page reloads. Polling pauses while the browser tab is hidden.

Writes go through the same GitHub Contents API with optimistic concurrency: on a
`409` SHA conflict — which happens when a monitoring run commits at the same
moment — the file is re-read and the change is re-applied on top, up to four
attempts.

---

## 9. Data files

Everything the tool knows lives in four files in this repository.

**`data/monitors.json`** — the configuration. Edit it through the dashboard, or
by hand and push.

```json
{
  "monitors": [
    {
      "id": "example-com",
      "name": "Example",
      "url": "https://example.com",
      "enabled": true
    },
    {
      "id": "example-api-health",
      "name": "Example API health",
      "url": "https://example.com/api/health",
      "type": "health",
      "enabled": true
    }
  ]
}
```

`type` is optional and defaults to `"website"` — see
[Health endpoints](#health-endpoints) below.

**`data/status.json`** — current state per monitor: status, HTTP code, response
time, error, last check, the time it entered that state, cumulative check
counters, rolling uptime for 24h/7d/30d, and the incident count.

**`data/history.json`** — one record per check, trimmed to the last **30 days**
on every run:

```json
{
  "timestamp": "2026-08-19T15:36:04.812Z",
  "monitorId": "example-com",
  "status": "UP",
  "statusCode": 200,
  "responseTime": 184,
  "error": null
}
```

**`data/incidents.json`** — one record per outage, with `startedAt`, `endedAt`,
`durationMs`, `status` (`ongoing` / `resolved`) and the failing check's details.
`lastNotifiedAt` records when Telegram was last told about it, which is what
the reminder interval counts from.

**`data/subscribers.json`** — the chats that sent `/start`, plus the `getUpdates`
cursor. See [who receives alerts](#who-receives-alerts).

---

## 10. Alerting rules

Messages fire on *transitions*, not on checks. A site that is still down does
not produce one on every check — only when it changes state, and, while an
outage lasts, on the reminder interval described below:

```text
15:00 UP     →  nothing
15:03 UP     →  nothing
15:06 UP     →  nothing
15:09 DOWN   →  🔴 SITE DOWN
15:12 DOWN   →  nothing
15:15 DOWN   →  nothing
15:18 UP     →  🟢 SITE RECOVERED
```

**A failure is looked at twice before it counts.** One dropped packet used to be
enough to open an incident and wake someone up, and at one check an hour that
alert then stood for an hour. Now a failing check is repeated `CONFIRM_RETRIES`
times (2) `CONFIRM_DELAY_SECONDS` apart (10), and the outage is only declared if
it survives all of them. A site that answers on the second probe never reaches
Telegram at all — the run just notes it:

```text
? Sharyn — Connection timeout; re-checking (1/2) in 10s
UP Sharyn — recovered on re-check 1, not alerting on "Connection timeout"
```

Only failures a second look could honestly disagree with are repeated: a
timeout, a DNS or TLS error, a 5xx, a 408 or a 429. A considered answer from the
far end — 404, 401, a sign-in the portal rejected, a health endpoint reporting
trouble — is believed at once. That distinction is not politeness: repeating a
rejected sign-in is how portal accounts get locked out. A monitor that is
already down is probed once too, since two more probes would change no decision.

The cost is time, not money: a newly failing site adds about half a minute to
the run. Set `CONFIRM_RETRIES=0` to go back to believing the first answer.

**An outage that is still going says so again.** Firing only on transitions has
a quiet failure of its own: an incident here ran for 33 hours on a single
message, sent the moment it started. Scrolled past at night, that is
indistinguishable from a healthy night. So every
`REMINDER_INTERVAL_MINUTES` (360, i.e. 6 hours) an outage still in progress
repeats itself:

```text
🔴 SITE STILL DOWN

ZhanaUrpaq

Down for:
8 hours 12 minutes

Since:
21 Sept 2026, 04:04 GMT+5

Failed checks:
9

Error:
Connection timeout

URL:
https://zhanaurpaq.kz
```

The clock runs from the last message about that incident, not from its start,
so the reminders are evenly spaced however late the first one was. Reminders
are sent after the run's real news, and they force a commit of their own —
otherwise the same reminder would come due again on the next run. Set
`REMINDER_INTERVAL_MINUTES=0` to announce an outage once and never mention it
again.

**Down, with an HTTP response:**

```text
🔴 SITE DOWN

Example

URL:
https://example.com

Status:
HTTP 503

Response:
2.40 s

Time:
19 Aug 2026, 15:42
```

**Down, with a transport error:**

```text
🔴 SITE DOWN

Example

URL:
https://example.com

Error:
Connection timeout

Time:
19 Aug 2026, 15:42
```

**Recovered:**

```text
🟢 SITE RECOVERED

Example

Downtime:
6 minutes

Status:
HTTP 200

Response:
183 ms

Time:
19 Aug 2026, 15:48
```

**The monitor itself going quiet is also an alert.** If a run starts and the
last recorded check is more than `STALE_AFTER_MINUTES` old (90 by default), it
reports the gap before anything else:

```text
⚠️ MONITORING GAP

Nothing was checked for:
3 hours 24 minutes

Last check before the gap:
18 Sept 2026, 08:41 GMT+5

Checking resumed:
18 Sept 2026, 12:05 GMT+5

Any outage inside that window went undetected — the statuses below it are
older than they look.
```

This is the failure that is otherwise invisible: when the schedule stalls, every
monitor keeps its last known status, the dashboard keeps showing it, and an
unchecked hour looks exactly like a healthy one. The alert says plainly that the
green was not measured.

Times in Telegram messages carry their time zone, so an alert is never
ambiguous. They default to UTC; set the repository variable `DISPLAY_TIMEZONE`
to an IANA name (Settings → Secrets and variables → Actions → Variables) to get
them in your own zone instead:

```text
DISPLAY_TIMEZONE = Asia/Almaty   ->  19 Aug 2026, 18:49 GMT+5
DISPLAY_TIMEZONE = Europe/Moscow ->  19 Aug 2026, 16:49 GMT+3
unset, or not a valid zone       ->  19 Aug 2026, 13:49 UTC
```

The dashboard is unaffected by this setting — it always renders in the viewer's
own time zone, and every time on it has a tooltip with the full local date.

---

## Health endpoints

A monitor is one URL, and its `type` decides how the answer is judged:

| `type` | Judged by |
| --- | --- |
| `website` (default) | HTTP status code only — 200–399 is up |
| `health` | HTTP status code **and** the JSON body |
| `login` | Actually signing into the portal — see [Portal login checks](#portal-login-checks) |

A health endpoint is a monitor in its own right, not an attachment to a website
one. Add it with the **Health endpoint** tab in the add dialog, or by setting
`"type": "health"` in `data/monitors.json`. Monitor a site, a health endpoint, or
both as separate entries — that is your choice, nothing is coupled.

For a `health` monitor the body is parsed as JSON and its `status` field is read
(`state` and `health` are accepted as aliases). These values count as healthy:

```text
ok  up  healthy  pass  passing  success  green  true
```

So an endpoint answering

```json
{ "status": "ok", "timestamp": "2026-08-19T12:08:16.452Z" }
```

is up, while

```json
{ "status": "degraded", "timestamp": "2026-08-19T12:08:16.452Z" }
```

is **down even though the HTTP status was 200** — which is the whole point of
marking it as a health endpoint. The alert then says what was reported, instead
of a bare "HTTP 200" that would read as if nothing were wrong:

```text
🔴 HEALTH CHECK FAILED

Example API health

URL:
https://example.com/api/health

Reported:
degraded

Status:
HTTP 200

Time:
19 Aug 2026, 12:08
```

Details worth knowing:

- A response that is **not JSON**, or JSON **without** a recognised status field,
  is judged on its HTTP code alone — a plain `OK` body will not fail a monitor.
- A non-2xx/3xx response is down regardless of the body.
- Only the first 64 KB of the body is read (`MAX_HEALTH_BODY_BYTES`).
- Health URLs go through exactly the same validation and SSRF protection as any
  other monitor URL.
- The last reported value is stored in `status.json` and shown on the card and
  the monitor page. `history.json` keeps only up/down, as for any monitor.
- Monitors written before this existed have no `type` and stay `website`.

---

## Portal login checks

A `website` monitor only proves the page loads — a login form can happily
answer HTTP 200 while the sign-in itself is broken (bad DB connection, expired
certificate on an auth service, a bug in the login handler). A `login` monitor
catches that: every run it actually **signs into the portal** with real
credentials and judges the platform on whether that succeeds, not on whether
the login page rendered.

Add it with the **Portal login** tab in the add dialog, or by setting
`"type": "login"` in `data/monitors.json`. The `url` is the sign-in page. Credentials
are **never** entered in the dialog and never stored in `data/monitors.json` —
that file is public and committed to the repo. Instead, add a `PORTAL_CREDENTIALS`
secret under **Settings → Secrets and variables → Actions**.

When the same account signs into every portal, one `"default"` entry covers
all of them:

```json
{ "default": { "username": "monitor@example.com", "password": "..." } }
```

A per-id entry (the monitor's id, shown on its card and in its URL —
`/monitor/<id>`) overrides or extends `"default"` for just that one monitor,
so a field that differs for a single portal doesn't need the whole credential
repeated — e.g. a platform whose API is multi-tenant and needs an `X-Site-Key`
header to pick the right tenant:

```json
{
  "default": { "username": "monitor@example.com", "password": "..." },
  "darynast-kz": { "siteKey": "..." },
  "some-other-portal": { "username": "a-different-account", "password": "..." }
}
```

A `login` monitor whose id has no `username`/`password` after merging with
`"default"` is reported down with "No credentials configured" — nothing is
probed until one is set.

Two submission styles are supported (`loginBodyType`, set via the "Send
credentials as a JSON body" checkbox in the add dialog):

- **`form`** (default) — a classic server-rendered login: fetch the sign-in
  page, carry over its cookies and any hidden fields (CSRF tokens included)
  unchanged, then POST the username and password `application/x-www-form-urlencoded`
  under the field names the form actually uses.
- **`json`** — an API-driven single-page app: POST `{ "<usernameField>": ...,
  "<passwordField>": ... }` as JSON to `loginUrl` instead. This is what four of
  the portals in this deployment turned out to be — a Vite/React app that
  itself calls `POST /api/auth/login` with a JSON body and answers with
  `{ "accessToken": ..., "user": ... }` on success or `{ "error": "..." }` on
  failure — discovered by reading the deployed JS bundle, since the login page
  itself renders client-side and has no server-side form to inspect.

Up is decided, in order:

1. `failureText` present in the response -> down.
2. `successText` set -> up only if it's present in the response.
3. A redirect (3xx) -> up — the usual outcome of a successful form post.
4. `json` mode -> up unless the body carries its own `error`/`message` field
   (covers a login that fails but still answers 200).
5. `form` mode -> up unless the response still shows a password field where
   the sign-in page had one, i.e. the same form was handed back.

The defaults work without further configuration for a plain HTML login form or
a JSON API that reports errors as `error`/`message`. For anything else — a
different success/failure signal, non-standard field names — set the advanced
fields in the add dialog:

| Field | Purpose |
| --- | --- |
| Form target URL | Where the form/API POSTs, if different from the login page URL |
| Send as JSON | Switches from a form POST to a JSON POST |
| Username / password field name | The actual field/key names, if not `username`/`password` |
| Success text | A string only present once signed in (e.g. `accessToken`) — makes the check exact |
| Failure text | A string only present when sign-in fails (e.g. "неверный пароль") |

None of the advanced fields are secret — they describe the request's shape,
not who signs into it — so they live in `data/monitors.json` like everything
else. `siteKey` is the exception: it functions as an API access key, so it
lives in `PORTAL_CREDENTIALS` alongside the username and password, never in
`data/monitors.json`.

A down alert names the platform and the time, exactly like any other monitor,
just headed `🔴 PORTAL LOGIN FAILED` / `🟢 PORTAL LOGIN RECOVERED` instead of
`SITE DOWN` / `SITE RECOVERED`.

For local runs, set `PORTAL_CREDENTIALS` in `.env` (see `.env.example`) before
`npm run monitor`.

---

## Who receives alerts

Alerts go to every chat that has subscribed, plus `TELEGRAM_CHAT_ID` when it is
set. To subscribe, send the bot:

```text
/start
```

and to stop:

```text
/stop
```

The bot confirms both. Subscribers live in `data/subscribers.json`, so the list
is versioned like everything else.

By default **there is no server listening for these messages.** The monitoring
run polls Telegram's `getUpdates` at the start of every pass and acts on
whatever arrived since the last one, so a `/start` is picked up on the next run
rather than instantly — press **Run check** on the dashboard if you do not want
to wait. Telegram keeps undelivered updates for 24 hours, which comfortably
covers the gap between runs; the read cursor is stored in `subscribers.json` so
an update is never handled twice. [Register the webhook](#talking-to-the-bot)
to get answers in a second instead.

Chats that block or delete the bot answer `403`, and are removed from the list
automatically rather than failing on every future alert.

> **Anyone who can find your bot can subscribe**, and alerts name your hosts
> and when they were down. If the bot might be discoverable, set the
> `TELEGRAM_SUBSCRIBE_PASSWORD` secret — then only `/start <passphrase>`
> subscribes and everything else gets a polite refusal. Note that
> `data/subscribers.json` records each subscriber's chat id and display name,
> which is another reason to keep this repository private.

---

## Talking to the bot

The bot understands four commands:

| Command | What it does |
| --- | --- |
| `/status` | The current board: every enabled monitor, worst first, with how long it has been in that state and when it was last checked |
| `/start` | Receive alerts in this chat (`/start <passphrase>` when `TELEGRAM_SUBSCRIBE_PASSWORD` is set) |
| `/stop` | Stop receiving them |
| `/help` | The list above |

`/status` answers with the last recorded state — the same data the dashboard
shows — and says how old it is. If nothing has been checked for longer than
`STALE_AFTER_MINUTES`, it says that too, because a stalled schedule is exactly
when someone thinks to ask:

```text
🔴 1 of 3 down

🔴 ZhanaUrpaq
   down 4 hours · Connection timeout

🟢 Daryn AST
   up 12 days · 980 ms · 99.87% 24h

🟢 Sharyn
   up 3 days · 1.21 s · 100.00% 24h

Checked 12 minutes ago — 21 Sept 2026, 12:37 GMT+5
```

### Answering in a second instead of within the hour

Polled from the run, a command is answered whenever the next run happens —
which, on GitHub's schedule, can be an hour. The dashboard can answer instead:
`POST /api/telegram` is a Telegram webhook, and it replies immediately.

1. Set `TELEGRAM_BOT_TOKEN` and a `TELEGRAM_WEBHOOK_SECRET` (any long random
   string) in the Vercel project — plus `TELEGRAM_SUBSCRIBE_PASSWORD` if you
   gate `/start`, and `DISPLAY_TIMEZONE` for the timestamp. Redeploy.
2. Point Telegram at it:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://your-dashboard.vercel.app/api/telegram",
       "secret_token":"YOUR_TELEGRAM_WEBHOOK_SECRET",
       "allowed_updates":["message"]}'
```

3. Optionally give Telegram the command menu, so the bot offers them:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setMyCommands" \
  -H 'Content-Type: application/json' \
  -d '{"commands":[
       {"command":"status","description":"How every site is doing"},
       {"command":"start","description":"Receive alerts here"},
       {"command":"stop","description":"Stop receiving alerts"},
       {"command":"help","description":"What this bot can do"}]}'
```

Telegram refuses `getUpdates` while a webhook is registered, so the run stops
polling on its own and logs `answered by the dashboard webhook — not polling
here`. Nothing else changes: alerts are still sent by the run, and `/start` and
`/stop` still end up in `data/subscribers.json`, committed by the dashboard
rather than by the run. `deleteWebhook` puts everything back to polling.

The endpoint refuses to answer at all unless `TELEGRAM_WEBHOOK_SECRET` is set,
and rejects any request without that secret in the
`X-Telegram-Bot-Api-Secret-Token` header — otherwise anyone who guessed the URL
could forge updates and make the bot subscribe or message arbitrary chats.

---

## Running a check by hand

The dashboard's **Run check** button starts a monitoring run immediately, for
when you do not want to wait for the next scheduled window — right after adding
a monitor, for instance.

It sends a `repository_dispatch` event, which the workflow listens for, and the
run does a single pass so it finishes in well under a minute. The button shows
"Checking…" until the results land, then the dashboard refreshes itself.

Deliberately a `repository_dispatch` and not a `workflow_dispatch`: the latter
would need an extra "Actions: write" scope on `GITHUB_TOKEN`, while the former
is covered by the "Contents: write" the dashboard already requires. Nothing to
change about your token.

Two things to know:

- Manual runs are throttled to one every 30 seconds. Each one still costs a
  GitHub Actions minute.
- `GITHUB_BRANCH` is not consulted here — `repository_dispatch` always runs the
  workflow from the repository's default branch.

The same thing is available from the Actions tab (**Website Monitor → Run
workflow**), where you can also choose how long the run keeps checking.

---

## Why the schedule is hourly

`cron: "*/3 * * * *"` does not work. GitHub's scheduler is best-effort and drops
the ticks it cannot serve — on this repository a three-minute schedule was
measured firing **4 times in 78 minutes**, at gaps of 31, 21 and 25 minutes. The
runs all succeeded; GitHub simply never started the others.

So the schedule no longer asks for the interval. The run itself does the timing:
one job stays alive for `LOOP_MINUTES` and checks every `LOOP_INTERVAL_SECONDS`,
driven by a clock inside the run instead of GitHub's scheduler.

**Hourly is not honoured reliably either.** A plain `cron: "0 * * * *"` produced
22–27 runs a day until 26 Aug 2026 and 3–9 runs a day after it — about one tick
in three, each started 0–60 minutes late, with no failed runs and no change on
this side. Every executed run leaves a commit (the commit interval is 30
minutes, shorter than the schedule), so the git log doubles as the run log:
`git log --format='%ad %s' --date=format:'%Y-%m-%d'` counted per day is how the
gap was measured, and how to re-measure it later.

Hence the current schedule: **three offset ticks an hour** (`:07`, `:27`,
`:47`), never at the top of the hour, which is the most contended slot. Asking
three times does not mean paying three times — the **Due for a check?** step
runs before dependencies are installed and exits at once, for about a minute of
runner time, whenever the last recorded check is less than `MIN_GAP_MINUTES`
(45) old. So a served tick either becomes the hour's run or costs a minute, and
the hour is covered as long as GitHub serves at least one of the three.

Nothing here can make GitHub fire a tick it decided to drop. Three offset ticks
took this repository from 6–8 runs a day to 11–13, which is better and still
not hourly: holes of four and five hours survived. To close them the clock has
to come from somewhere GitHub does not control — see below.

### The heartbeat endpoint

A monitor that is not running cannot notice that it is not running. The gap is
only ever discovered by the run that ends it, so "start a check when a gap is
detected" cannot come from the workflow itself — by the time it could detect
anything, it is already running. The detection has to happen somewhere that is
always awake, and the dashboard on Vercel already is.

`GET /api/heartbeat` reads `data/status.json`, and if the last check is older
than `HEARTBEAT_STALE_MINUTES` (75 by default) it starts a run through the same
`repository_dispatch` event as the **Run check** button. Otherwise it just
reports the age. No session is needed; set `HEARTBEAT_TOKEN` in Vercel to
require one, as `?token=…` or `Authorization: Bearer …`.

```console
$ curl -s https://your-dashboard.vercel.app/api/heartbeat
{"lastCheck":"2026-09-21T09:58:11.031Z","ageMinutes":22,"stale":false,"triggered":false}

$ curl -s https://your-dashboard.vercel.app/api/heartbeat
{"lastCheck":"2026-09-21T05:08:44.512Z","ageMinutes":291,"stale":true,"triggered":true}
```

Then point anything that can fetch a URL at it — a GitLab pipeline schedule, a
free uptime service, a cron box, another CI. **Ping it often, every 5–15
minutes.** That costs nothing: a run is only started when the data is actually
stale, so a ping every five minutes is still at most one run an hour, and a
missed hour is repaired within minutes instead of waiting for GitHub to feel
like it. The `⚠️ MONITORING GAP` alert then means both clocks failed, which is
worth knowing.

A GitLab schedule (Settings → CI/CD → Schedules, `0 * * * *` or finer) is one
job:

```yaml
heartbeat:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - curl -sS --fail "$MONITOR_HEARTBEAT_URL?token=$MONITOR_HEARTBEAT_TOKEN"
```

Two self-hosted schedulers beat one shared one: GitLab's runs on your instance,
not in a queue shared with everyone else's crons.

An external scheduler can also skip the endpoint and call GitHub directly, if
you would rather not have the dashboard in the path — the event is the same:

```bash
curl -sS --fail -X POST \
  -H "Authorization: Bearer $GITHUB_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{"event_type":"run-check"}'
```

The difference is what it costs: this starts a run on every tick, while the
endpoint starts one only when a check is actually missing.

**This deployment is budgeted at 1 minute of runner time per hour**
(`LOOP_MINUTES=1`, `LOOP_INTERVAL_SECONDS=60`), which is one check per hour.
It was 2 while the schedule was delivering ~7 runs a day; now that the schedule
aims for 24, the window had to come down to pay for the extra runs. Raise
`LOOP_MINUTES` and `LOOP_INTERVAL_SECONDS` together to get closer to continuous
coverage — see the table below — and note that a window shorter than
`LOOP_INTERVAL_SECONDS` fits exactly one check.

A looping run commits and pushes on its own as soon as a status changes, so
alerts and the dashboard do not wait for the window to end. Set `LOOP_MINUTES`
to `0` for the old behaviour — one check, then exit — which is what
`npm run monitor` does locally.

### Actions minutes

This trades scheduler reliability for runner time, and runner time is metered on
private repositories. **Check your usage at
<https://github.com/settings/billing> before leaving this running.**

- Public repositories: Actions minutes are free. Nothing to think about.
- Private repositories: GitHub Free includes 2,000 minutes/month. A 50-minute
  window every hour is roughly 36,000 minutes/month, far beyond that.

If you are on a private repository and want to stay inside the free allowance,
set the repository variable `LOOP_MINUTES` lower (Settings → Secrets and
variables → Actions → Variables). Some reference points, at ~1 billed minute per
minute of runner time:

| `LOOP_MINUTES` | Coverage | Approx. minutes/month |
| --- | --- | --- |
| `50` | continuous, at `LOOP_INTERVAL_SECONDS` | ~36,000 |
| `10` | 10 min of every hour | ~7,300 |
| `2` | 2 min of every hour — 2 checks | ~2,200 |
| `1` (current) | one check per hour | ~1,500 |
| `0` | one check per hour, committed by the workflow | ~1,500 |

The window is not the whole bill: checkout, `npm ci` and the push add roughly a
minute to every run, and the ticks that are served but not due add about a
minute each. Budget on the order of `(LOOP_MINUTES + 1) × 24 × 30` minutes a
month, then check the real figure on the billing page after a few days — it is
the only number that counts.

`LOOP_INTERVAL_SECONDS` must be smaller than the window, or the window fits a
single check: 2 minutes at the 180s default would be one check per hour, not
two.

Note the trade-off is real either way: a low `LOOP_MINUTES` gives accurate
three-minute checking inside its window and no checking at all outside it, while
`0` gives one check an hour, evenly spread. Pick whichever failure you would
rather have.

---

## 11. Why it does not commit on every check

A commit every three minutes would be 480 commits a day and would make the git
history useless. So a run commits only when it has something to say:

- a monitor changed status (`UP → DOWN` or `DOWN → UP`);
- an incident opened or closed;
- a monitor was added or removed;
- it is the first run;
- or `COMMIT_INTERVAL_MINUTES` (default **30**) has passed since the last commit.

Between commits the check samples are **not** thrown away. They are buffered in
`.monitor-cache/` and carried from one run to the next through `actions/cache`,
then folded into `history.json` at the next commit. So history keeps its full
~3-minute resolution while the git log stays a record of outages.

The visible consequence: while everything is healthy, the dashboard's "last run"
timestamp advances at the commit interval, not at the check interval. Set
`COMMIT_INTERVAL_MINUTES` lower (as a repository variable) if you want a fresher
dashboard at the cost of more commits.

---

## 12. Security

- `GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`, `ADMIN_PASSWORD` and `PORTAL_CREDENTIALS`
  are read only in server code. None are prefixed `NEXT_PUBLIC_`, and the
  modules that touch them are marked `server-only`, so a build fails rather
  than shipping them to the browser.
- `PORTAL_CREDENTIALS` only ever exists as a GitHub Actions secret (or a local
  `.env`, gitignored). `data/monitors.json` is public and committed, so a
  `login` monitor stores the shape of the form (field names, success/failure
  text) but never a username or password.
- The dashboard, the monitor pages and every data API require a session. The
  session cookie is **HttpOnly**, **Secure** in production, **SameSite=Lax**, and
  carries nothing but an expiry plus an HMAC-SHA256 signature over it. Tampering
  with the expiry invalidates the signature.
- **`/api/heartbeat` is the one exception**, because the machines that ping it
  have no session. What it exposes is one timestamp — how long ago a check ran
  — and what it can do is start the same run the schedule would have started,
  at most once per five-minute cooldown and only when a check is genuinely
  missing — and the workflow's concurrency group means even a burst of those
  queues into one run at a time rather than piling up. (The cooldown lives in
  the memory of one serverless instance, so a flood spread across instances can
  get a few through; the staleness check is the bound that always holds.) It
  cannot read your monitors. Set `HEARTBEAT_TOKEN` if even the timestamp should
  stay private.
- Password checks and signature comparisons are constant-time; login is rate
  limited.
- **SSRF protection.** The monitoring script fetches URLs you supply, so URLs are
  validated twice:
  - **when saved** — only `http:` and `https:`, at most 2048 characters, no
    embedded credentials, no control characters, and no internal hostname
    (`localhost`, `*.local`, `*.internal`, `*.home.arpa`, `metadata.google.internal`,
    bare dot-less names, …) or private IP literal;
  - **when requested** — the hostname is resolved and every returned address is
    checked before the socket connects, and the connection is pinned to a vetted
    address. This closes the DNS-rebinding gap where a public hostname resolves
    to a private address.

  Blocked ranges include `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`,
  `127.0.0.0/8`, `169.254.0.0/16` (cloud metadata), `172.16.0.0/12`,
  `192.168.0.0/16`, `198.18.0.0/15`, the TEST-NET blocks, multicast and reserved
  space, plus `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8` and IPv4-mapped,
  NAT64 and 6to4 forms of all of the above.
- Redirects are **not** followed. A `301`/`302` is treated as a healthy response
  in its own right, which also means a redirect cannot be used to reach an
  internal address.

---

## 13. Configuration reference

**Vercel environment variables**

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | yes | — | Fine-grained token with Contents: read/write |
| `GITHUB_OWNER` | yes | — | Repository owner |
| `GITHUB_REPO` | yes | — | Repository name |
| `ADMIN_PASSWORD` | yes | — | Dashboard password |
| `GITHUB_BRANCH` | no | `main` | Branch holding the data files |
| `SESSION_SECRET` | no | derived from `ADMIN_PASSWORD` | Session cookie signing key |
| `DATA_CACHE_TTL_SECONDS` | no | `20` | In-memory cache for GitHub reads |
| `HEARTBEAT_TOKEN` | no | — | Shared secret for `/api/heartbeat`; unset leaves it open |
| `HEARTBEAT_STALE_MINUTES` | no | `75` | How old the last check must be before a ping starts a run |
| `TELEGRAM_BOT_TOKEN` | no | — | Needed only to answer the bot from the dashboard — see [talking to the bot](#talking-to-the-bot) |
| `TELEGRAM_WEBHOOK_SECRET` | no | — | Required for `/api/telegram` to answer at all; matched against Telegram's header |
| `TELEGRAM_SUBSCRIBE_PASSWORD` | no | — | Same passphrase as the Actions secret, so webhook `/start` is gated too |
| `DISPLAY_TIMEZONE` | no | `UTC` | Zone for the timestamp in `/status` |
| `STALE_AFTER_MINUTES` | no | `90` | When `/status` warns that its data is old |

**GitHub Actions secrets**

| Secret | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | no | Sending alerts |
| `TELEGRAM_CHAT_ID` | no | Where alerts go |
| `PORTAL_CREDENTIALS` | no | Credentials for `login` monitors — see [Portal login checks](#portal-login-checks) |

**GitHub Actions repository variables** (Settings → Secrets and variables →
Actions → *Variables*) — all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMMIT_INTERVAL_MINUTES` | `30` | How often results are committed when nothing changed |
| `CHECK_TIMEOUT_MS` | `10000` | Per-request timeout |
| `CONFIRM_RETRIES` | `2` | Extra probes a failure must survive before it counts as DOWN; `0` believes the first answer |
| `CONFIRM_DELAY_SECONDS` | `10` | Pause between those probes |
| `REMINDER_INTERVAL_MINUTES` | `360` | How often an ongoing outage repeats itself in Telegram; `0` announces it once |
| `HISTORY_RETENTION_DAYS` | `30` | How long history is kept |
| `MAX_HEALTH_BODY_BYTES` | `65536` | How much of a health response is read |
| `MAX_LOGIN_BODY_BYTES` | `262144` | How much of a login-flow response is read |
| `LOOP_MINUTES` | `1` | How long one run keeps checking; `0` = one check and exit |
| `LOOP_INTERVAL_SECONDS` | `60` | Interval between checks inside a run |
| `MIN_GAP_MINUTES` | `45` | A scheduled tick landing sooner than this after the last check exits without checking |
| `STALE_AFTER_MINUTES` | `90` | How long a gap in checking has to be before it is reported to Telegram |
| `DISPLAY_TIMEZONE` | `UTC` | IANA zone for times in Telegram alerts |

---

## 14. Limits and honest caveats

- **The interval is driven by the run, not the schedule.** GitHub will not fire
  a three-minute cron, so the workflow starts on an hourly-ish schedule and does
  its own timing (see [why the schedule is hourly](#why-the-schedule-is-hourly)).
  At the current `LOOP_MINUTES=1` that means **one check per hour**, and nothing
  for the other 59 minutes. An outage starting just after a check can go
  unnoticed for nearly an hour. Raise `LOOP_MINUTES` to shrink that gap, at the
  cost of runner minutes.
- **The schedule is GitHub's to keep, and it does not always keep it.** Ticks
  are dropped without notice — measured here at roughly two in three, and still
  about half after moving to three offset ticks an hour — which is why a gap in
  checking raises its own Telegram alert. If an hour must genuinely never be
  missed, do not rely on GitHub's scheduler at all: ping
  [the heartbeat endpoint](#the-heartbeat-endpoint) from a clock you control.
- **Runner time is metered on private repositories.** A continuous 50-minute
  window every hour will exceed the free 2,000 minutes/month several times over.
  See [Actions minutes](#actions-minutes).
- **Up to 20–30 websites.** The dashboard enforces a hard limit of 30 monitors.
  Beyond that, `history.json` and the per-run commit start to get uncomfortable.
- **Dashboard freshness follows the commit interval,** not the check interval —
  see [section 11](#11-why-it-does-not-commit-on-every-check).
- **Checks run from GitHub's runners**, from one region, over IPv4/IPv6 as the
  runner sees fit. This tells you whether a site is reachable from the public
  internet, not how it performs for your users.
- **`history.json` grows with your site count.** At 30 days, 5 sites and a
  3-minute cadence that is roughly 70k records (~10 MB). The script trims to
  `HISTORY_RETENTION_DAYS` on every run and enforces a hard cap of 200k records;
  lower the retention if you monitor many sites.
- **Single owner.** One password, no user accounts, no roles, no teams. That is
  deliberate.

---

## 15. Local development

```bash
npm install
cp .env.example .env.local   # then fill in the four required values
npm run dev                  # http://localhost:3000
```

Run a check against the local `data/` files without committing anything:

```bash
npm run monitor
```

Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to your environment first if you
want to see the alerts. Note that `npm run monitor` writes the files in `data/`
directly — revert them afterwards if you were only testing.

Checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`.github/workflows/checks.yml` runs the first three on every push and pull
request that touches something other than `data/`, so the monitor's own hourly
commits never start a build.

### Tests

`npm test` runs the Node test runner over `tests/*.test.ts` through `tsx`. No
test framework is installed and none is needed; the suite takes well under a
second.

What is covered is the judgement, not the plumbing — the decisions that are
wrong quietly rather than loudly:

| File | What it pins down |
| --- | --- |
| `tests/transitions.test.ts` | UP/DOWN transitions, opening and closing incidents, outage duration, reminder scheduling, check totals, untouched disabled monitors |
| `tests/confirm.test.ts` | Which failures are re-probed and which are believed at once, and how many probes each case costs |
| `tests/reminders.test.ts` | When an ongoing outage repeats itself |
| `tests/heartbeat.test.ts` | When a ping starts a run, and the cooldown that stops a burst of them |
| `tests/telegram.test.ts` | Command parsing, the `/status` board in every state, and the subscriber list |
| `tests/security.test.ts` | The SSRF guard: schemes, credentials, internal hostnames, private and reserved addresses |
| `tests/utils.test.ts` | The text of the alerts — durations, response times, uptime, timestamps and their zone |

The pattern to follow when adding behaviour: put the decision in a pure
function under `lib/`, and let `scripts/monitor.ts` do the reading, sending and
committing around it. That is why `lib/transitions.ts` exists apart from the
script — the script cannot be imported by a test, because importing it runs a
monitoring pass.

---

## 16. Troubleshooting

**The dashboard says "Missing environment variable: GITHUB_TOKEN".**
Add the variable in Vercel → Settings → Environment Variables, then redeploy.

**The dashboard says "GitHub API returned 401 … Bad credentials".**
The token is wrong or expired. Generate a new fine-grained token with Contents:
read/write on this repository.

**The dashboard says "GitHub API returned 404".**
`GITHUB_OWNER` / `GITHUB_REPO` do not match, the token is not scoped to that
repository, or `GITHUB_BRANCH` points at a branch that does not exist.

**The workflow fails on the commit step with "permission denied".**
Settings → Actions → General → Workflow permissions → *Read and write
permissions*.

**No Telegram messages arrive.**
Check the workflow log: it prints how many chats an alert was delivered to, and
says so explicitly when there are no recipients yet. If it reports none, send
`/start` to the bot and run a check. Remember that alerts are only sent on
transitions — a site that was already down when you set things up will not
re-alert.

**I sent `/start` but nothing happened.**
The bot only reads its messages while a monitoring run is in progress, so wait
for the next run or press **Run check**. If you set
`TELEGRAM_SUBSCRIBE_PASSWORD`, plain `/start` is refused — send
`/start <passphrase>`.

**A site I know is up shows as DOWN with "Blocked: resolves to a private
address".**
The hostname resolves into private IP space. That is the SSRF protection doing
its job; this tool only monitors publicly reachable sites.

**Scheduled runs stopped.**
Either the repository has had no activity for 60 days (push any commit to
re-enable), Actions is disabled for the repository, or you have run out of
Actions minutes — check <https://github.com/settings/billing>.

**Runs are far apart / checks are less frequent than expected.**
Look at whether `LOOP_MINUTES` is set low, and remember the gap between runs is
not covered when it is. Then count the runs GitHub actually started — every run
leaves a commit, so

```bash
git log --format='%ad' --date=format:'%Y-%m-%d' | uniq -c
```

is a run-per-day histogram. Well under 24 means GitHub is dropping ticks, not
that the monitor is broken; see
[why the schedule is hourly](#why-the-schedule-is-hourly).

**A site alerted as DOWN and recovered a minute later.**
A failure now has to survive `CONFIRM_RETRIES` extra probes, so a blip that
short means the site really was unreachable for all of them. If it keeps
happening on a site you believe is healthy, the far end is probably slower than
`CHECK_TIMEOUT_MS` under load — raise that, or raise `CONFIRM_DELAY_SECONDS` so
the probes are spread wider.

**A `⚠️ MONITORING GAP` alert arrived.**
Working as intended: nothing was checked for longer than `STALE_AFTER_MINUTES`,
and the run that finally happened said so. Usually dropped scheduled ticks. If
it repeats, give the deployment an outside clock — see
[the heartbeat endpoint](#the-heartbeat-endpoint). If one is already pinging,
the alert means it stopped too: check that the pinger still runs and that
`curl https://your-dashboard.vercel.app/api/heartbeat` answers.

**Telegram alerts show a time that is not mine.**
Set the repository variable `DISPLAY_TIMEZONE` to your IANA zone, e.g.
`Asia/Almaty`. Alerts always print the zone next to the time, so you can see
which one is in effect. The dashboard is separate: it uses your browser's zone,
and hovering any time shows the full local date.

---

## Project structure

```text
app/
├── page.tsx                 landing page
├── dashboard/page.tsx       the dashboard
├── monitor/[id]/page.tsx    per-monitor detail
├── login/page.tsx           password prompt
└── api/                     monitors, status, history, incidents, auth

components/
├── dashboard/               stats bar, monitor cards, add dialog, login form
├── monitor/                 detail view, history table, incident list
├── charts/                  response-time chart (Recharts)
└── ui/                      shadcn/ui primitives, theme, polling hook

lib/
├── github.ts                Contents API client, caching, conflict retries
├── auth.ts                  password check and signed session cookie
├── security.ts              URL validation and SSRF protection
├── storage.ts               typed access to the four JSON files
├── api.ts                   shared route-handler helpers
├── types.ts                 shared data model
└── utils.ts                 formatting helpers

scripts/monitor.ts           the entire monitoring backend
data/                        monitors, status, history, incidents
.github/workflows/monitor.yml
middleware.ts                route protection
```

---

## License

MIT
