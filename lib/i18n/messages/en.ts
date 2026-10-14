/**
 * English interface copy. `ru.ts` must provide the same shape; the type is
 * derived from this file, so a missing Russian string fails the typecheck.
 */
export const en = {
  meta: {
    title: 'Site Monitor',
    description:
      'Know when your website goes down. Hourly uptime checks on GitHub Actions, checks on demand, and Telegram alerts.',
    dashboard: 'Dashboard',
    monitor: 'Monitor',
    signIn: 'Sign in',
  },

  common: {
    openDashboard: 'Open dashboard',
    signOut: 'Sign out',
    telegramBot: 'Open the Telegram bot',
    toggleTheme: 'Toggle dark mode',
    language: 'Language',
    skipToContent: 'Skip to content',
    home: 'Site Monitor home',
    requestFailed: 'Request failed',
  },

  landing: {
    navFeatures: 'Features',
    navHow: 'How it works',
    pill: 'Uptime monitoring without a server',
    title: 'Know the minute your site goes down.',
    subtitle:
      'Hourly checks from GitHub Actions, on-demand checks from the dashboard, and one Telegram alert per outage. No servers.',
    seeHow: 'See how it works',
    stackLabel: 'Runs entirely on tools you already use',
    featuresTitle: 'Everything a small team needs. Nothing it has to run.',
    alertsTitle: 'Alerts that know when to stop',
    alertsBody:
      'One message when a site goes down and one when it comes back. In between, a reminder every six hours, not a flood.',
    alertSent: 'Alert sent',
    recovered: 'Recovered',
    sampleOutage: 'Sample outage over 24 hours, one bar per hour',
    kindsTitle: 'Three ways to check',
    kinds: [
      { title: 'Website', body: 'Up on any HTTP 200 to 399.' },
      { title: 'Health endpoint', body: 'Reads the JSON status field too.' },
      { title: 'Portal login', body: 'Actually signs in on every run.' },
    ],
    sslValue: '5 days',
    sslTitle: 'SSL reminders',
    sslBody: 'Set the expiry date once. Telegram warns you ahead of time and again on the day.',
    cadenceTitle: 'Checked every hour',
    cadenceBody:
      'Three schedule ticks an hour, so one gets through even when GitHub drops the rest. Need it sooner? Press Run check.',
    cadenceRun: 'Run',
    cadenceSkipped: 'Skipped tick',
    repoTitle: 'Your repo is the database',
    repoBody: 'Status, history and incidents are JSON files in Git. Readable and versioned.',
    howTitle: 'Set up in the time it takes to read this.',
    steps: [
      {
        title: 'Add a URL',
        body: 'A website, a JSON health endpoint, or a portal login form. The dashboard writes it to the repository.',
      },
      {
        title: 'Actions probes it',
        body: 'A scheduled workflow checks every monitor once an hour, re-checks a failure before believing it, and commits the result.',
      },
      {
        title: 'Telegram tells you',
        body: 'An alert when a site goes down, a reminder while it stays down, and a note when it recovers.',
      },
    ],
    closingTitle: 'Stop finding out from your users.',
    footer: 'Uptime monitoring on GitHub Actions, Vercel and Telegram.',
    preview: {
      sampleData: 'Sample data',
      allOperational: 'All systems operational',
      someDown: (down: number, total: number) => `${down} of ${total} monitors down`,
      lastChecks: 'Last 60 checks per monitor',
      checkingNow: 'Checking now',
      caption: 'An example of the dashboard with four sample monitors, one of them down.',
    },
  },

  header: {
    monitors: 'Monitors',
    dashboard: 'Dashboard',
  },

  dashboard: {
    title: 'Monitors',
    allOperational: 'All systems operational',
    down: (down: number, total: number) =>
      `${down} of ${total} ${total === 1 ? 'monitor is' : 'monitors are'} down`,
    runsOn: 'Checks run on GitHub Actions',
    lastRun: (relative: string) => `Last run ${relative}.`,
    reload: 'Reload data',
    runCheck: 'Run check',
    checking: 'Checking',
    runningTitle: 'Check running on GitHub Actions',
    runningBody: 'Every monitor is being probed now. Results usually appear within a minute.',
    runErrorTitle: 'Could not start a check',
    runErrorFallback: 'Could not start a check',
    runTimeout: 'The check did not report back in time. Look at the Actions tab.',
    loadErrorTitle: 'Could not load monitor data',
    filterLabel: 'Filter monitors',
    filters: { all: 'All', down: 'Down', up: 'Up', paused: 'Paused' },
    search: 'Search monitors',
    searchPlaceholder: 'Search by name or host',
    clearSearch: 'Clear search',
    listLabel: 'Monitors',
    columns: { monitor: 'Monitor', history: 'Last 24 hours', response: 'Response', uptime: 'Uptime' },
    noMatchTitle: 'No monitors match',
    noMatchBody: 'Try another filter or clear the search.',
    showAll: 'Show all monitors',
    historyError: (error: string) => `The 24-hour history could not be loaded: ${error}`,
    emptyTitle: 'Add your first monitor',
    emptyBody: 'Paste a URL. The next scheduled run checks it and this page fills in.',
  },

  stats: {
    monitors: 'Monitors',
    online: 'Online',
    down: 'Down',
    uptime30d: 'Uptime, 30 days',
    avgResponse: 'Avg response, 24h',
  },

  row: {
    types: { health: 'Health', login: 'Login' },
    paused: 'Paused',
    dayAgo: '24h ago',
    checkedAt: (clock: string) => `checked ${clock}`,
    notChecked: 'not checked yet',
    response: 'Response',
    uptime30d: '30d uptime',
    actionsFor: (name: string) => `Actions for ${name}`,
    edit: 'Edit',
    pause: 'Pause',
    resume: 'Resume',
    details: 'View details',
    delete: 'Delete',
  },

  bars: {
    noChecksWindow: (from: string, to: string) => `${from} to ${to}: no checks`,
    allUpWindow: (from: string, to: string, total: number) => `${from} to ${to}: ${total} checks, all up`,
    failedWindow: (from: string, to: string, down: number, total: number) =>
      `${from} to ${to}: ${down} of ${total} checks failed`,
    none: 'No checks recorded in this period',
    allUp: 'Up in every period with checks',
    some: (bad: number, total: number) => `Failures recorded in ${bad} of ${total} periods`,
  },

  ssl: {
    today: 'SSL expires today',
    tomorrow: 'SSL expires tomorrow',
    inDays: (days: number) => `SSL in ${days} days`,
    expiredAgo: (days: number) => `SSL expired ${days} day${days === 1 ? '' : 's'} ago`,
    expiresOn: (date: string) => `SSL certificate expires ${date}`,
  },

  dialog: {
    addMonitor: 'Add monitor',
    kinds: {
      website: {
        tab: 'Website',
        title: 'Add website',
        description: 'The next monitoring run picks it up, usually within a few minutes.',
        urlLabel: 'Website URL',
        urlPlaceholder: 'https://example.com',
        namePlaceholder: 'Example Website',
        hint: 'Up when the page answers with an HTTP status of 200 to 399.',
        submit: 'Add website',
      },
      health: {
        tab: 'Health endpoint',
        title: 'Add health endpoint',
        description: 'The next monitoring run picks it up, usually within a few minutes.',
        urlLabel: 'Health endpoint URL',
        urlPlaceholder: 'https://example.com/api/health',
        namePlaceholder: 'Example API health',
        hint: 'If it answers JSON with a "status" field, that field must report ok. Otherwise the check fails even on HTTP 200.',
        submit: 'Add health endpoint',
      },
      login: {
        tab: 'Portal login',
        title: 'Add portal login check',
        description:
          'Signs into the portal on every run instead of just loading the page, so a broken login counts as down. ' +
          'The credentials themselves are never entered here. Add them as the PORTAL_CREDENTIALS secret, keyed by this monitor’s id (see the README).',
        urlLabel: 'Login page URL',
        urlPlaceholder: 'https://portal.example.com/login',
        namePlaceholder: 'Example Portal',
        hint: 'Fetches this page, submits the sign-in form with the configured credentials, and checks the result.',
        submit: 'Add login check',
      },
    },
    editTitle: (name: string) => `Edit ${name}`,
    editLoginDescription: (id: string) =>
      `Changes apply from the next monitoring run. The id stays "${id}", so its PORTAL_CREDENTIALS entry, history and incidents are kept.`,
    editDescription: 'Changes apply from the next monitoring run. History and incidents are kept.',
    name: 'Name',
    nameHint: 'Optional. The hostname is used when left empty.',
    sslLabel: 'SSL certificate expires',
    sslHint: 'Optional. Telegram is warned 5 days before this date and again on the day.',
    advanced: 'Advanced and optional. The defaults work for a plain HTML sign-in form.',
    loginUrl: 'Form target URL',
    loginUrlPlaceholder: 'Defaults to the login page URL above',
    jsonBody: 'Send credentials as a JSON body instead of a form',
    jsonBodyHint: 'For an API-driven sign-in (a single-page app posting JSON), not a plain HTML form.',
    usernameField: 'Username field name',
    passwordField: 'Password field name',
    successText: 'Success text',
    successPlaceholder: 'Text that only appears once signed in',
    failureText: 'Failure text',
    failurePlaceholder: 'Text that only appears when sign-in fails',
    textHint:
      'Without either, a login counts as successful once the sign-in form is no longer shown back to it.',
    saveError: 'Could not save the monitor',
    addError: 'Could not add the monitor',
    save: 'Save changes',
  },

  login: {
    title: 'Sign in',
    description: 'Enter the admin password to open the dashboard.',
    password: 'Password',
    submit: 'Sign in',
    failed: 'Sign in failed',
  },

  detail: {
    ranges: { '24h': '24H', '7d': '7D', '30d': '30D' },
    notFound: 'Monitor not found',
    notFoundBody: 'It may have been removed from data/monitors.json.',
    back: 'Back to dashboard',
    backShort: 'Dashboard',
    paused: 'Paused',
    operational: 'Operational',
    down: 'Down',
    waiting: 'Waiting for the first check',
    reported: (value: string) => `reported: ${value}`,
    healthEndpoint: 'Health endpoint',
    loginCheck: 'Login check',
    runsOn: 'Checks run on GitHub Actions',
    lastCheck: (relative: string) => `. Last check ${relative}.`,
    downTitle: 'This site is currently down',
    downSince: (date: string) => `Down since ${date}.`,
    uptime30d: 'Uptime, 30 days',
    avgResponse: 'Average response',
    checks: 'Checks',
    incidents: 'Incidents',
    responseTime: 'Response time',
    history: 'History',
  },

  history: {
    empty: 'No checks recorded yet.',
    time: 'Time',
    status: 'Status',
    http: 'HTTP',
    response: 'Response',
    up: 'UP',
    down: 'DOWN',
  },

  incidents: {
    empty: 'No incidents recorded.',
    unavailable: (name: string) => `${name} became unavailable`,
    duration: 'Duration',
    ongoing: 'Ongoing',
    resolved: 'Resolved',
  },

  chart: {
    empty: 'No checks recorded in this period yet.',
    axisMs: (value: number) => `${value} ms`,
    failed: (count: number) => `${count} failed check${count === 1 ? '' : 's'}`,
  },

  report: {
    button: 'Report',
    title: 'Uptime report',
    description: 'A PDF of every outage in the period: when it happened, how long it lasted and how often.',
    period: 'Period',
    presets: { week: '7 days', days30: '30 days', thisMonth: 'This month', lastMonth: 'Last month' },
    from: 'From',
    to: 'To',
    scope: 'Monitors',
    allMonitors: 'All monitors',
    retentionNote:
      'Check history is kept for 30 days. Earlier days still list every outage, without check counts or response times.',
    invalidRange: 'Pick a start date on or before the end date.',
    tooLong: 'A report can cover at most a year.',
    cancel: 'Cancel',
    download: 'Download PDF',
    building: 'Building report',
    failed: 'The report could not be built',
  },
}

export type Messages = typeof en
