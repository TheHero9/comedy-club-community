/**
 * Every user-facing string in the web app lives here.
 *
 * Project rule: never hardcode a user-facing string inside a component.
 * `tests/copy.spec.ts` enforces it by parsing every .tsx under app/ and
 * components/ and failing on any rendered literal with three or more letters.
 *
 * LANGUAGE (design handoff, 2026-08-09): the product surface is **Bulgarian**.
 * The earlier "UI chrome is English" ruling is superseded for everything the
 * redesign covers - the handoff states the Bulgarian copy in the prototype is
 * final and must not be translated. A handful of structural labels stay Latin
 * because the design shows them that way: "Public", "Elite", "Member",
 * "Podcast Index", the score band names, and the footer column headings.
 *
 * Conventions:
 * - Grouped by surface. Functions where a value needs interpolation.
 * - No emoji. Icons come from lucide-react at the component layer.
 * - No em-dash or en-dash. Plain hyphen only, in Bulgarian and English alike.
 */

/** Bulgarian month names, nominative. Used for every rendered date. */
const MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
] as const;

export const copy = {
  app: {
    name: "Podcast Index",
    shortName: "Podcast Index",
    tagline: "Всеки епизод. Всеки момент. Намираем.",
    description:
      "Общностен индекс на български подкаст епизоди. Търси по теми, моменти и гости, оценявай и си води списък какво си гледал.",
  },

  nav: {
    homeLink: "Podcast Index - начало",
    home: "Начало",
    channels: "Канали",
    episodes: "Епизоди",
    search: "Търсене",
    profile: "Профил",
    leaderboard: "Класация",
    status: "Състояние",
    notFound: "404",
    openSearch: "Отвори търсенето",
    primaryNav: "Основна навигация",
    sectionNav: "Раздели",
    toggleTheme: "Смени темата",
    toLight: "Светла тема",
    toDark: "Тъмна тема",
    signIn: "Влез",
    signOut: "Излез",
    columnBrowse: "BROWSE",
    columnSite: "SITE",
    footerBlurb:
      "Общностен индекс на български подкаст епизоди. Видеата остават в YouTube.",
  },

  home: {
    heroLine1: "Всеки епизод.",
    heroLine2: "Всеки момент.",
    heroLine3: "Намираем.",
    subhead: (episodes: number) =>
      `${episodes} епизода, обозначени от общността с теми, моменти и оценки.`,
    topRated: "Най-високо оценени",
    seeAll: "всички",
    newest: "Най-нови",
    channels: "Канали",
    channelMeta: (episodes: number, average: string) =>
      `${episodes} епизода / ${average} средно`,
    channelMetaNoAverage: (episodes: number) => `${episodes} епизода`,
    rank: (n: number) => `Място ${n}`,
  },

  search: {
    trigger: "Търси момент, тема или гост",
    title: "Търси нещо, което се е случило",
    subtitle: "Не само заглавия. Търсенето минава през теми, моменти и гости.",
    popularTopics: "ПОПУЛЯРНИ ТЕМИ",
    suggestions: "ПРЕДЛОЖЕНИЯ",
    inputLabel: "Търсене в епизодите",
    submit: "Търси",
    close: "Затвори",
    resultCount: (n: number) => (n === 1 ? "1 епизод" : `${n} епизода`),
    resultsFor: (count: string, query: string) => `${count} за „${query}“`,
    notInAnyTitle: "Думата не се среща в нито едно заглавие.",
    tookMs: (ms: number) => `${ms}ms`,
    zeroTitle: "Нищо не съвпада",
    zeroBody:
      "Правописните грешки вече се прощават, така че думата най-вероятно още не е отбелязана.",
    zeroCta: "Разгледай всички епизоди",
    promptTitle: "Търси нещо, което се е случило",
    reasonTopic: "ТЕМА",
    reasonMoment: "МОМЕНТ",
    reasonMomentAt: (timestamp: string) => `МОМЕНТ ${timestamp}`,
    reasonTopicVotes: (votes: number) => ` / ${votes} гласа`,
    examples: [
      "счупен хладилник",
      "баница",
      "историята с колата",
      "квантова физика",
    ],
    backendNote: (backend: string) => `via ${backend}`,
  },

  channels: {
    title: "Канали",
    // The design's line also carries a site-wide rating total. There is no
    // endpoint that returns one, and inventing it on a page about how much has
    // been rated would be the worst possible place to guess, so the count of
    // rated episodes stands in for it - a number the grid payload really has.
    subtitle: (channels: number, episodes: number, rated: number) =>
      `${channels === 1 ? "1 канал" : `${channels} канала`}, ${episodes} епизода, ${rated} оценени.`,
    viewGrid: "Виж решетката",
    handleAndCount: (handle: string, episodes: number) =>
      `${handle} / ${episodes} епизода`,
    episodeCount: (n: number) => (n === 1 ? "1 епизод" : `${n} епизода`),
    subscribers: (formatted: string) => `${formatted} абонати`,
    empty: "Още няма индексиран канал.",
    sparklineYear: (year: number) => `Година ${year}`,
  },

  channel: {
    gridTitle: "Решетка на оценките",
    hintMobile: "Редовете са епизоди, колоните са години.",
    hintDesktop: "Редовете са години, колоните са позицията в годината.",
    publicScore: "Public",
    eliteScore: "Elite",
    scoreModeLabel: "Вид оценка",
    statAverage: "средна оценка",
    statAverageElite: "elite средно",
    statRated: "оценени",
    statBest: "най-добър",
    statBestYear: "най-добра година",
    statRatings: "дадени оценки",
    ratedOf: (rated: number, total: number) => `${rated}/${total}`,
    seasonAverage: (average: string) => `avg ${average}`,
    recent: "Скорошни епизоди",
    gridLabel: (channel: string) => `Решетка на оценките за ${channel}`,
    episodeColumn: "Епизод",
    yearColumn: "Година",
    cellLabel: (title: string, score: string) => `${title}, оценка ${score}`,
    empty: "Този канал още няма епизоди с дата, така че няма какво да се покаже.",
  },

  band: {
    masterpiece: "Absolute cinema",
    awesome: "Awesome",
    great: "Great",
    good: "Good",
    regular: "Regular",
    bad: "Bad",
    garbage: "Garbage",
    unrated: "Без оценка",
    provisional: "Малко оценки",
    membersOnly: "Само за членове",
    stream: "Стрийм",
  },

  episode: {
    number: (n: number) => `Епизод ${n}`,
    scoreLabel: "ОЦЕНКА",
    outOfTen: "/10",
    rate: "Оцени",
    yourRating: (score: number) => `Твоята ${score}`,
    ratings: (n: number) => `${n} оценки`,
    noRatings: "още няма оценки",
    noRatingsShort: "без оценки",
    elite: "Elite",
    membersOnly: "Само за членове",
    stream: "Стрийм",
    playOnYouTube: "Гледай в YouTube",
    watchOnYouTube: "Гледай в YouTube",
    addFirstTopic: "Добави първата тема",
    descriptionMore: "още",
    descriptionLess: "по-малко",
    noDescription: "Без описание.",
    cast: "Участници",
    roleHost: "домакин",
    roleGuest: "гост",
    /**
     * `EpisodeParticipant.role` is a semantic key ("host" / "guest"), which is
     * the project rule: data carries keys, the component layer maps them. This
     * is that map. An unknown key falls back to "гост" rather than printing the
     * raw English key at a Bulgarian reader.
     */
    role: (key: string) => (key === "host" ? "домакин" : "гост"),
    moments: "Моменти",
    momentsEmptyTitle: "Още нищо не е отбелязано",
    momentsEmptyBody:
      "Час плюс няколко думи. Това прави епизода намираем по-късно.",
    momentsEmptyCta: "Добави първия момент",
    momentVotes: (n: number) => (n > 0 ? `+${n}` : String(n)),
    community: "Оценки от общността",
    writeReview: "Напиши мнение",
    spoilerNotice: "Съдържа спойлери",
    spoilerReveal: "Покажи",
    spoilerHide: "Скрий пак",
    similar: "Подобни епизоди",
    similarByTopic: "по тема и участници",
    similarSameChannel: "от същия канал",
    similarTagTopic: (topic: string) => `тема: ${topic}`,
    similarTagGuest: (name: string) => `с ${name}`,
    markWatched: "Отбележи като гледано",
    watchedCount: (n: number) => `Гледано ${n}x`,
    logDate: "Запиши дата",
    favorite: "Добави в любими",
    unfavorite: "Махни от любими",
    watchedByYou: "Гледано от теб",
    watchCount: (n: number) => `${n}x`,
    watchLogEmpty:
      "Още нямаш записана дата. Може да добавиш и минали дати, включително за преслушвания.",
    removeWatch: (date: string) => `Премахни ${date}`,
    yourScore: "Твоята оценка",
    noScoreYet: "-",
    notRatedNote: "още не си оценил",
    firstRatingNote: "първата оценка",
    deltaNote: (delta: string) => `${delta} спрямо публичната`,
    changeRating: "Промени",
    clearRating: "Изчисти",
    breakdownLabel: "Разпределение на оценките",
    noViewData: "без данни за гледания",
    views: (formatted: string) => `${formatted} гледания`,
    openEpisode: "Отвори епизода",
    cellPosition: (year: number, index: number) => `${year} / епизод ${index}`,
    provisionalNote: "Под 3 оценки, числото още не е надеждно.",
    commentsEmptyTitle: "Още няма мнения",
    commentsEmptyBody:
      "Кажи какво мислиш. Спойлерите си имат отделен превключвател.",
    commentsEmptyCta: "Напиши първото",
    topicsEmptyTitle: "Още няма теми",
    topicsEmptyBody:
      "Темите са общи за целия сайт и се свеждат до едно канонично име.",
    topicsEmptyCta: "Предложи тема",
  },

  rating: {
    sheetTitle: "Твоята оценка",
    save: "Запази",
    remove: "Премахни",
    compare: (publicScore: string, mine: number) =>
      `Публична оценка ${publicScore} / твоята ${mine}`,
    noPublicYet: "Няма публична оценка все още.",
    pick: (n: number) => `Оценка ${n}`,
    saving: "Запазва се",
    savedToast: "Оценката е запазена",
    removedToast: "Оценката е премахната",
    failedToast: "Оценката не се запази, опитай пак",
    retry: "Опитай пак",
  },

  watchLog: {
    sheetTitle: "Кога го гледа",
    sheetBody:
      "Всяко гледане се записва отделно, включително преслушвания месеци по-късно.",
    quickToday: "Днес",
    quickYesterday: "Вчера",
    quickThisWeek: "Тази седмица",
    quickLastMonth: "Миналия месец",
    pickDate: "ИЗБЕРИ ДАТА",
    recorded: (n: number) => `Записани гледания ${n}x`,
    done: "Готово",
    savedToast: (date: string) => `Записано: ${date}`,
    duplicateToast: "Вече е записано за тази дата",
    futureToast: "Не може да запишеш бъдеща дата",
    clearedToast: "Изчистено от гледаните",
    favoriteToast: "Добавено в любими",
    unfavoriteToast: "Махнато от любими",
    watchedToast: "Гледането е записано",
    historyEmptyTitle: "История на гледане е празна",
    historyEmptyBody:
      "Отбележи епизод като гледан и преслушванията ще се трупат тук по дати.",
    historyEmptyCta: "Разгледай епизодите",
  },

  browse: {
    title: "Епизоди",
    showing: (shown: number, total: number) =>
      `показани ${shown} от ${total}`,
    filters: "Филтри",
    filtersWithCount: (n: number) => `Филтри ${n}`,
    clear: "Изчисти",
    clearFilters: "Изчисти филтрите",
    apply: (n: number) => `Покажи ${n} епизода`,
    loadMore: "Зареди още",
    emptyTitle: "Нищо не съвпада с филтрите",
    emptyBody: (summary: string) => `Активни са ${summary}.`,
    emptyFallbackSummary: "няколко филтъра",
    removeFilter: (label: string) => `Премахни филтъра ${label}`,
    groupSort: "ПОДРЕДБА",
    groupKind: "ВИД",
    groupYear: "ГОДИНА",
    groupChannel: "КАНАЛ",
    groupPerson: "УЧАСТНИК",
    chipYear: "година",
    chipKind: "вид",
    chipChannel: "канал",
    chipPerson: "с",
    sortNewest: "Най-нови",
    sortOldest: "Най-стари",
    sortTop: "Най-високо оценени",
    sortLowest: "Най-ниско оценени",
    sortMostRated: "Най-много оценки",
    kindVideo: "Видео",
    kindStream: "Стрийм",
  },

  profile: {
    memberBadge: "Member",
    statRatings: "оценки",
    statWatched: "изгледани",
    statFavorites: "любими",
    histogramTitle: "Как оценяваш",
    histogramNote: (average: string, delta: string) =>
      `Средна твоя оценка ${average}, което е ${delta} над средното за сайта.`,
    histogramNoteBelow: (average: string, delta: string) =>
      `Средна твоя оценка ${average}, което е ${delta} под средното за сайта.`,
    linkRatings: "Моите оценки",
    linkHistory: "История на гледане",
    linkFavorites: "Любими",
    linkTags: "Моите етикети",
    historyTitle: "История на гледане",
    ratingsEmptyTitle: "Още няма оценки",
    ratingsEmptyBody:
      "Още не си оценил нищо. Всяка страница на епизод има бутон за оценка.",
    ratingsEmptyCta: "Разгледай епизодите",
    tagsEmptyTitle: "Няма лични етикети",
    tagsEmptyBody: "Твои собствени етикети за епизоди. Никой друг не ги вижда.",
    tagsEmptyCta: "Как работи",
    privateTag: "Личен етикет",
  },

  leaderboard: {
    title: "Класация",
    kindTop: "Най-високи",
    kindElite: "Elite",
    kindMostRated: "Най-оценявани",
    rank: (n: number) => `${n}`,
    ratings: (n: number) => `${n} оценки`,
    empty: "Още няма достатъчно оценки за класация.",
  },

  status: {
    title: "Състояние",
    healthy: "Всичко работи",
    degraded: "Degraded",
    unreachable: "API не отговаря",
    checkedAt: (relative: string) => relative,
    dependencyOk: "ok",
    dependencyDown: "не отговаря",
    database: "Database",
    redis: "Redis",
    recheck: "Провери пак",
    rechecking: "Проверява се",
    recheckSucceeded: "API отговаря.",
    recheckDegraded: "API отговори, но зависимост не работи.",
    recheckFailed: "API не отговаря.",
    unreachableHint:
      "Пусни API с `uv run python manage.py runserver` в apps/api и провери пак.",
    redisDegradedToast: "Redis не отговаря, останалото работи",
  },

  notFound: {
    code: "404",
    title: "Няма такава страница",
    body: "Ако си дошъл от стар линк, търсенето вероятно ще намери епизода.",
    searchCta: "Търси епизод",
    backHome: "Обратно към началото",
    browseEpisodes: "Разгледай епизодите",
  },

  auth: {
    signInTitle: "Влез, за да оцениш",
    signInBody:
      "Оценките, гледанията и любимите се пазят към профила ти. Влизането отнема секунда.",
    signIn: "Влез",
    later: "По-късно",
    signedOutToast: "Влез, за да запазиш това",
  },

  errors: {
    generic: "Нещо се обърка. Опитай пак.",
    network: "API не отговаря. Провери дали работи.",
    timeout: "API се забави твърде много.",
    notFound: "Не намерихме това, което търсиш.",
    unauthorized: "Трябва да влезеш, за да направиш това.",
    forbidden: "Нямаш права за това.",
    rateLimited: "Твърде много заявки. Забави малко.",
    server: "API върна грешка.",
    parse: "API върна отговор, който не можем да прочетем.",
  },

  common: {
    loading: "Зарежда се",
    retry: "Опитай пак",
    dismiss: "Затвори",
    unknown: "Няма данни",
    close: "Затвори",
    back: "Назад",
    open: "Отвори",
    more: "още",
    separator: ".",
    months: MONTHS,
  },
} as const;

export type Copy = typeof copy;
