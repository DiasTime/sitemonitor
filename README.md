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
- **Two kinds of monitor** — a *website*, judged by its HTTP status code, or a
  *health endpoint*, whose JSON body is inspected too, so an endpoint answering
  HTTP 200 while reporting trouble counts as down. Pick the kind in the add
  dialog; each is an independent monitor.
- **Telegram alerts** on the transitions only: one message when a site goes
  down, one when it comes back.
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
3. Send any message to your new bot (a bot cannot message you first).
4. Get your chat id by opening this URL in a browser, with your token in place:

   ```text
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```

   Look for `"chat":{"id":123456789`. That number is your `TELEGRAM_CHAT_ID`.
   For a group chat the id is negative — include the minus sign.

Telegram is optional. Without it the monitoring still runs and records
everything; it just does not send messages.

---

## 4. Add the GitHub Actions secrets

In your repository: **Settings → Secrets and variables → Actions → New
repository secret**.

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | The token from BotFather |
| `TELEGRAM_CHAT_ID` | The chat id from `getUpdates` |

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

The workflow is scheduled with `cron: "*/3 * * * *"` and can also be started by
hand with `workflow_dispatch`. Each run:

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
7. writes the JSON files back and tells the workflow whether to commit.

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

---

## 10. Alerting rules

Only *transitions* produce messages. A site that is still down does not generate
a message every three minutes:

```text
15:00 UP     →  nothing
15:03 UP     →  nothing
15:06 UP     →  nothing
15:09 DOWN   →  🔴 SITE DOWN
15:12 DOWN   →  nothing
15:15 DOWN   →  nothing
15:18 UP     →  🟢 SITE RECOVERED
```

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

Times in Telegram messages are UTC.

---

## Health endpoints

A monitor is one URL, and its `type` decides how the answer is judged:

| `type` | Judged by |
| --- | --- |
| `website` (default) | HTTP status code only — 200–399 is up |
| `health` | HTTP status code **and** the JSON body |

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

- `GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN` and `ADMIN_PASSWORD` are read only in
  server code. None are prefixed `NEXT_PUBLIC_`, and the modules that touch them
  are marked `server-only`, so a build fails rather than shipping them to the
  browser.
- The dashboard, the monitor pages and every data API require a session. The
  session cookie is **HttpOnly**, **Secure** in production, **SameSite=Lax**, and
  carries nothing but an expiry plus an HMAC-SHA256 signature over it. Tampering
  with the expiry invalidates the signature.
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

**GitHub Actions secrets**

| Secret | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | no | Sending alerts |
| `TELEGRAM_CHAT_ID` | no | Where alerts go |

**GitHub Actions repository variables** (Settings → Secrets and variables →
Actions → *Variables*) — all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMMIT_INTERVAL_MINUTES` | `30` | How often results are committed when nothing changed |
| `CHECK_TIMEOUT_MS` | `10000` | Per-request timeout |
| `HISTORY_RETENTION_DAYS` | `30` | How long history is kept |
| `MAX_HEALTH_BODY_BYTES` | `65536` | How much of a health response is read |

---

## 14. Limits and honest caveats

- **The schedule is approximate.** GitHub's scheduled workflows are best-effort.
  Under load a run can be delayed by several minutes, and during incidents on
  GitHub's side it may be skipped entirely. The UI says *"checks approximately
  every 3 minutes"* for a reason — do not treat this as a second-accurate SLA
  monitor.
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
npm run build
```

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
Check the workflow log: the script prints an explicit line when the token or
chat id is missing, or when the Telegram API rejects the call. Remember that you
must message the bot first, and that alerts are only sent on transitions — a
site that was already down when you set things up will not re-alert.

**A site I know is up shows as DOWN with "Blocked: resolves to a private
address".**
The hostname resolves into private IP space. That is the SSRF protection doing
its job; this tool only monitors publicly reachable sites.

**Scheduled runs stopped.**
Either the repository has had no activity for 60 days (push any commit to
re-enable), or Actions is disabled for the repository.

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
