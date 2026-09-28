import type { Messages } from '@/lib/i18n/messages/en'
import { plural } from '@/lib/ru'

const checks = (count: number) => `${count} ${plural(count, ['проверка', 'проверки', 'проверок'])}`
const days = (count: number) => `${count} ${plural(count, ['день', 'дня', 'дней'])}`
const monitors = (count: number) => plural(count, ['монитора', 'мониторов', 'мониторов'])

/** Russian interface copy, same shape as `en.ts`. */
export const ru: Messages = {
  meta: {
    title: 'Site Monitor',
    description:
      'Узнайте, когда ваш сайт перестал работать. Ежечасные проверки доступности в GitHub Actions, проверки по запросу и оповещения в Telegram.',
    dashboard: 'Панель',
    monitor: 'Монитор',
    signIn: 'Вход',
  },

  common: {
    openDashboard: 'Открыть панель',
    signOut: 'Выйти',
    toggleTheme: 'Переключить тёмную тему',
    language: 'Язык',
    skipToContent: 'Перейти к содержимому',
    home: 'Site Monitor, главная',
    requestFailed: 'Запрос не выполнен',
  },

  landing: {
    navFeatures: 'Возможности',
    navHow: 'Как это работает',
    pill: 'Мониторинг доступности без сервера',
    title: 'Сайт упал? Вы узнаете первым.',
    subtitle:
      'Проверка каждый час из GitHub Actions, внеплановая из панели и одно оповещение в Telegram на каждый сбой. Без серверов.',
    seeHow: 'Как это работает',
    stackLabel: 'Работает на инструментах, которые у вас уже есть',
    featuresTitle: 'Всё, что нужно небольшой команде. И ничего, что нужно обслуживать.',
    alertsTitle: 'Оповещения, которые знают меру',
    alertsBody:
      'Одно сообщение, когда сайт упал, и одно, когда он снова работает. Между ними напоминание раз в шесть часов, а не поток.',
    alertSent: 'Оповещение',
    recovered: 'Восстановлен',
    sampleOutage: 'Пример сбоя за 24 часа, одна полоса на час',
    kindsTitle: 'Три вида проверок',
    kinds: [
      { title: 'Сайт', body: 'Работает при любом ответе HTTP от 200 до 399.' },
      { title: 'Health-эндпоинт', body: 'Читает и поле status в JSON.' },
      { title: 'Вход в портал', body: 'Реально входит в систему при каждой проверке.' },
    ],
    sslValue: '5 дней',
    sslTitle: 'Напоминания о SSL',
    sslBody: 'Укажите дату окончания один раз. Telegram предупредит заранее и ещё раз в сам день.',
    cadenceTitle: 'Проверка каждый час',
    cadenceBody:
      'Три запуска в час по расписанию, чтобы хотя бы один прошёл, даже если GitHub пропустит остальные. Нужно раньше? Нажмите «Проверить».',
    cadenceRun: 'Проверка',
    cadenceSkipped: 'Пропущенный запуск',
    repoTitle: 'Репозиторий и есть база данных',
    repoBody: 'Статус, история и инциденты хранятся в Git как JSON. Читаемо и с историей версий.',
    howTitle: 'Настройка займёт меньше, чем чтение этой страницы.',
    steps: [
      {
        title: 'Добавьте URL',
        body: 'Сайт, JSON health-эндпоинт или форму входа в портал. Панель запишет его в репозиторий.',
      },
      {
        title: 'Actions проверяет',
        body: 'Workflow по расписанию раз в час проверяет каждый монитор, перепроверяет сбой, прежде чем ему поверить, и сохраняет результат.',
      },
      {
        title: 'Telegram сообщает',
        body: 'Оповещение, когда сайт упал, напоминание, пока он недоступен, и сообщение, когда он восстановился.',
      },
    ],
    closingTitle: 'Хватит узнавать о сбоях от пользователей.',
    footer: 'Мониторинг доступности на GitHub Actions, Vercel и Telegram.',
    preview: {
      sampleData: 'Пример данных',
      allOperational: 'Все системы работают',
      someDown: (down, total) => `Недоступно: ${down} из ${total}`,
      lastChecks: 'Последние 60 проверок каждого монитора',
      checkingNow: 'Идёт проверка',
      caption: 'Пример панели с четырьмя мониторами, один из которых недоступен.',
    },
  },

  header: {
    monitors: 'Мониторы',
    dashboard: 'Панель',
  },

  dashboard: {
    title: 'Мониторы',
    allOperational: 'Все системы работают',
    down: (down, total) => `Недоступно ${down} из ${total} ${monitors(total)}`,
    runsOn: 'Проверки выполняются в GitHub Actions',
    lastRun: (relative) => `Последний запуск ${relative}.`,
    reload: 'Обновить данные',
    runCheck: 'Проверить',
    checking: 'Проверка',
    runningTitle: 'Проверка запущена в GitHub Actions',
    runningBody: 'Сейчас проверяются все мониторы. Результаты обычно появляются в течение минуты.',
    runErrorTitle: 'Не удалось запустить проверку',
    runErrorFallback: 'Не удалось запустить проверку',
    runTimeout: 'Проверка не вернула результат вовремя. Посмотрите вкладку Actions.',
    loadErrorTitle: 'Не удалось загрузить данные мониторов',
    filterLabel: 'Фильтр мониторов',
    filters: { all: 'Все', down: 'Недоступны', up: 'Работают', paused: 'На паузе' },
    search: 'Поиск мониторов',
    searchPlaceholder: 'Поиск по имени или хосту',
    clearSearch: 'Очистить поиск',
    listLabel: 'Мониторы',
    columns: { monitor: 'Монитор', history: 'Последние 24 часа', response: 'Отклик', uptime: 'Доступность' },
    noMatchTitle: 'Ничего не найдено',
    noMatchBody: 'Выберите другой фильтр или очистите поиск.',
    showAll: 'Показать все мониторы',
    historyError: (error) => `Не удалось загрузить историю за 24 часа: ${error}`,
    emptyTitle: 'Добавьте первый монитор',
    emptyBody: 'Вставьте URL. Следующий запуск по расписанию проверит его, и страница заполнится.',
  },

  stats: {
    monitors: 'Мониторы',
    online: 'Работают',
    down: 'Недоступны',
    uptime30d: 'Доступность, 30 дней',
    avgResponse: 'Средний отклик, 24 ч',
  },

  row: {
    types: { health: 'Health', login: 'Вход' },
    paused: 'На паузе',
    dayAgo: '24 ч назад',
    checkedAt: (clock) => `проверен в ${clock}`,
    notChecked: 'ещё не проверялся',
    response: 'Отклик',
    uptime30d: 'За 30 дней',
    actionsFor: (name) => `Действия для ${name}`,
    edit: 'Изменить',
    pause: 'Приостановить',
    resume: 'Возобновить',
    details: 'Подробнее',
    delete: 'Удалить',
  },

  bars: {
    noChecksWindow: (from, to) => `С ${from} до ${to}: проверок не было`,
    allUpWindow: (from, to, total) => `С ${from} до ${to}: ${checks(total)}, все успешны`,
    failedWindow: (from, to, down, total) => `С ${from} до ${to}: не прошло ${down} из ${checks(total)}`,
    none: 'За этот период проверок не было',
    allUp: 'Доступен во всех периодах с проверками',
    some: (bad, total) => `Сбои в ${bad} из ${total} периодов`,
  },

  ssl: {
    today: 'SSL истекает сегодня',
    tomorrow: 'SSL истекает завтра',
    inDays: (count) => `SSL через ${days(count)}`,
    expiredAgo: (count) => `SSL истёк ${days(count)} назад`,
    expiresOn: (date) => `SSL-сертификат истекает ${date}`,
  },

  dialog: {
    addMonitor: 'Добавить монитор',
    kinds: {
      website: {
        tab: 'Сайт',
        title: 'Добавить сайт',
        description: 'Его подхватит следующий запуск мониторинга, обычно в течение нескольких минут.',
        urlLabel: 'URL сайта',
        urlPlaceholder: 'https://example.com',
        namePlaceholder: 'Мой сайт',
        hint: 'Сайт считается доступным, если страница отвечает с HTTP-статусом от 200 до 399.',
        submit: 'Добавить сайт',
      },
      health: {
        tab: 'Health-эндпоинт',
        title: 'Добавить health-эндпоинт',
        description: 'Его подхватит следующий запуск мониторинга, обычно в течение нескольких минут.',
        urlLabel: 'URL health-эндпоинта',
        urlPlaceholder: 'https://example.com/api/health',
        namePlaceholder: 'Health моего API',
        hint: 'Если он отвечает JSON с полем "status", это поле должно сообщать ok. Иначе проверка не пройдёт даже при HTTP 200.',
        submit: 'Добавить эндпоинт',
      },
      login: {
        tab: 'Вход в портал',
        title: 'Добавить проверку входа',
        description:
          'При каждом запуске выполняет вход в портал, а не просто открывает страницу, поэтому сломанный вход считается сбоем. ' +
          'Учётные данные здесь не вводятся. Добавьте их в секрет PORTAL_CREDENTIALS по id этого монитора (см. README).',
        urlLabel: 'URL страницы входа',
        urlPlaceholder: 'https://portal.example.com/login',
        namePlaceholder: 'Мой портал',
        hint: 'Загружает эту страницу, отправляет форму входа с настроенными учётными данными и проверяет результат.',
        submit: 'Добавить проверку',
      },
    },
    editTitle: (name) => `Изменить ${name}`,
    editLoginDescription: (id) =>
      `Изменения применятся со следующего запуска. id останется "${id}", поэтому запись в PORTAL_CREDENTIALS, история и инциденты сохранятся.`,
    editDescription: 'Изменения применятся со следующего запуска. История и инциденты сохранятся.',
    name: 'Название',
    nameHint: 'Необязательно. Если пусто, используется имя хоста.',
    sslLabel: 'Срок действия SSL-сертификата',
    sslHint: 'Необязательно. Telegram предупредит за 5 дней до этой даты и ещё раз в сам день.',
    advanced: 'Дополнительно, необязательно. Значения по умолчанию подходят для обычной HTML-формы входа.',
    loginUrl: 'URL отправки формы',
    loginUrlPlaceholder: 'По умолчанию URL страницы входа выше',
    jsonBody: 'Отправлять учётные данные в JSON вместо формы',
    jsonBodyHint: 'Для входа через API (одностраничное приложение отправляет JSON), а не обычной HTML-формы.',
    usernameField: 'Поле логина',
    passwordField: 'Поле пароля',
    successText: 'Текст успеха',
    successPlaceholder: 'Текст, который появляется только после входа',
    failureText: 'Текст ошибки',
    failurePlaceholder: 'Текст, который появляется только при неудачном входе',
    textHint:
      'Если не указан ни один, вход считается успешным, когда форма входа больше не возвращается в ответе.',
    saveError: 'Не удалось сохранить монитор',
    addError: 'Не удалось добавить монитор',
    save: 'Сохранить',
  },

  login: {
    title: 'Вход',
    description: 'Введите пароль администратора, чтобы открыть панель.',
    password: 'Пароль',
    submit: 'Войти',
    failed: 'Не удалось войти',
  },

  detail: {
    ranges: { '24h': '24 ч', '7d': '7 дн', '30d': '30 дн' },
    notFound: 'Монитор не найден',
    notFoundBody: 'Возможно, он был удалён из data/monitors.json.',
    back: 'Вернуться к панели',
    backShort: 'Панель',
    paused: 'На паузе',
    operational: 'Работает',
    down: 'Недоступен',
    waiting: 'Ожидает первой проверки',
    reported: (value) => `статус: ${value}`,
    healthEndpoint: 'Health-эндпоинт',
    loginCheck: 'Проверка входа',
    runsOn: 'Проверки выполняются в GitHub Actions',
    lastCheck: (relative) => `. Последняя проверка ${relative}.`,
    downTitle: 'Сайт сейчас недоступен',
    downSince: (date) => `Недоступен с ${date}.`,
    uptime30d: 'Доступность, 30 дней',
    avgResponse: 'Средний отклик',
    checks: 'Проверки',
    incidents: 'Инциденты',
    responseTime: 'Время отклика',
    history: 'История',
  },

  history: {
    empty: 'Проверок пока не было.',
    time: 'Время',
    status: 'Статус',
    http: 'HTTP',
    response: 'Отклик',
    up: 'РАБОТАЕТ',
    down: 'СБОЙ',
  },

  incidents: {
    empty: 'Инцидентов не было.',
    unavailable: (name) => `${name}: сайт стал недоступен`,
    duration: 'Длительность',
    ongoing: 'Продолжается',
    resolved: 'Устранён',
  },

  chart: {
    empty: 'За этот период проверок пока не было.',
    axisMs: (value) => `${value} мс`,
    failed: (count) => `Неудачных: ${checks(count)}`,
  },
}
