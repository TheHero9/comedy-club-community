/**
 * Every user-facing string in the web app lives here, in both locales.
 *
 * Project rule: never hardcode a user-facing string inside a component.
 * `tests/copy.spec.ts` enforces it by parsing every .tsx under app/ and
 * components/ and failing on any rendered literal with three or more letters.
 *
 * LANGUAGE (owner ruling, 2026-08-15): **English is the DEFAULT** and Bulgarian
 * is a switchable alternative. This supersedes the 2026-08-09 design handoff,
 * which froze the prototype's Bulgarian chrome. The reason is plain: the
 * Bulgarian UI chrome reads as stilted to a native speaker, and the audience is
 * comfortable in English.
 *
 * 🚨 THIS FILE IS CHROME ONLY. Content is Bulgarian in BOTH locales and is never
 * translated: episode titles, descriptions, channel names, community topic
 * labels, moment labels and transcript passages all come from the API as
 * Bulgarian text and render as-is. Switching to English does not translate the
 * catalogue, and must never look like it promises to.
 *
 * A handful of structural labels are identical in both dictionaries because
 * they are brand-ish rather than prose: "Public", "Elite", "Member", and the
 * seven score-band names.
 *
 * Conventions:
 * - Grouped by surface. Functions where a value needs interpolation.
 * - No emoji. Icons come from lucide-react at the component layer.
 * - No em-dash or en-dash. Plain hyphen only, in Bulgarian and English alike.
 */

export const LOCALES = ["en", "bg"] as const;
export type Locale = (typeof LOCALES)[number];

/** 🚨 English, per the 2026-08-15 ruling. Changing this changes the SSR output. */
export const DEFAULT_LOCALE: Locale = "en";

/** The cookie the server reads and the toggle writes. */
export const LOCALE_COOKIE = "ccc_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Month names, nominative, used for every rendered date.
 *
 * ⚠️ Typed as a plain readonly array rather than a tuple. A tuple type would
 * make the Bulgarian names part of the TYPE, and the English dictionary could
 * then never satisfy it.
 */
type Months = readonly string[];

const MONTHS_BG: Months = [
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
];

const MONTHS_EN: Months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "6th", "21st", "3rd" - English only, and used only by the membership preview.
 *
 * 🚨 Deliberately NOT shared with the Bulgarian dictionary. Bulgarian ordinals
 * inflect for gender and do not suffix a numeral this way, so the Bulgarian
 * string says "на 6-о число" instead and never calls this. A "translated"
 * ordinal helper would be a fake abstraction over two unrelated grammars.
 */
function ordinal(day: number): string {
  // 11th, 12th, 13th are the exceptions the last-digit rule gets wrong.
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

// Identical in both dictionaries. The bands carry meaning and are styled by
// name; the design shows them in Latin and they are not translated.
const BANDS = {
  masterpiece: "Absolute cinema",
  awesome: "Awesome",
  great: "Great",
  good: "Good",
  regular: "Regular",
  bad: "Bad",
  garbage: "Garbage",
};

// ---------------------------------------------------------------------------
// English - the default dictionary, and the one that defines the shape
// ---------------------------------------------------------------------------

const en = {
  app: {
    name: "Comedy Club Community",
    shortName: "Comedy Club",
    tagline: "Every episode. Every moment. Findable.",
    description:
      "A community index of Bulgarian podcast episodes. Search by topic, moment and guest, rate what you watch, and keep track of it.",
  },

  nav: {
    homeLink: "Home",
    home: "Home",
    channels: "Channels",
    episodes: "Episodes",
    search: "Search",
    profile: "Profile",
    leaderboard: "Leaderboard",
    status: "Status",
    notFound: "404",
    openSearch: "Open search",
    primaryNav: "Primary navigation",
    sectionNav: "Sections",
    toggleTheme: "Switch theme",
    toLight: "Light theme",
    toDark: "Dark theme",
    signIn: "Sign in",
    signOut: "Sign out",
    columnBrowse: "BROWSE",
    columnSite: "SITE",
    footerBlurb:
      "A community index of Bulgarian podcast episodes. The videos stay on YouTube.",
    settings: "Settings",
    openSettings: "Open settings",
  },

  settings: {
    title: "Settings",
    description: "Saved on this device.",
    appearance: "Appearance",
    appearanceHint: "Dark is the default.",
    themeDark: "Dark",
    themeLight: "Light",
    language: "Language",
    /**
     * 🚨 Never dropped. Switching to English translates the interface and
     * nothing else - titles, topics, moments and transcripts stay Bulgarian
     * because that is what the podcasts are in. Without this line the toggle
     * silently promises a translated catalogue.
     */
    languageHint:
      "Interface only. Episode titles, topics and transcripts stay in Bulgarian.",
    languageEn: "English",
    languageBg: "Bulgarian",
    done: "Done",
  },

  home: {
    heroLine1: "Every episode.",
    heroLine2: "Every moment.",
    heroLine3: "Findable.",
    subhead: (episodes: number) =>
      `${episodes} episodes, labelled by the community with topics, moments and ratings.`,
    topRated: "Top rated",
    seeAll: "see all",
    newest: "Newest",
    channels: "Channels",
    channelMeta: (episodes: number, average: string) =>
      `${episodes} episodes / ${average} average`,
    channelMetaNoAverage: (episodes: number) => `${episodes} episodes`,
    rank: (n: number) => `Rank ${n}`,
  },

  search: {
    trigger: "Search a moment, topic or line",
    title: "Search for something that happened",
    subtitle:
      "Not just titles. Search runs across topics, moments, guests and what was actually said in the episode.",
    suggestions: "SUGGESTIONS",
    recent: "RECENT",
    inputLabel: "Search episodes",
    submit: "Search",
    close: "Close",
    clear: "Clear",
    /**
     * 🚨 The heading carries NO count, and that is deliberate.
     *
     * It used to be `<count> for "<query>"` where the count was the LABEL match
     * total alone - so a query with 2 label matches and 13 spoken ones printed
     * "2 episodes" above eight cards. There is no honest combined number to put
     * here either: the two halves are counted by two separate indexes and their
     * overlap is unknown, so any single figure would be a guess dressed as a
     * fact. The exact numbers live in the two summary lines below instead, each
     * one next to the section that renders what it counts.
     */
    resultsFor: (query: string) => `Results for "${query}"`,
    /** Every hit matched every word. */
    summaryLabelled: (n: number) =>
      n === 1
        ? "1 episode matches by title, topic or guest"
        : `${n} episodes match by title, topic or guest`,
    /** Some hits matched only part of the query. Both numbers are exact. */
    summaryLabelledSplit: (full: number, partial: number) =>
      `${full === 1 ? "1 episode matches" : `${full} episodes match`} all your words, ${partial} more match some`,
    /**
     * 🚨 Two numbers, two nouns, and they must never be collapsed into one.
     * "21 passages in 13 episodes" was accurate and still read as misleading,
     * because the page then rendered six cards - so this line is only ever
     * printed next to a section that can actually reach all of them.
     */
    summarySpoken: (episodes: number, segments: number) =>
      `Spoken in ${episodes === 1 ? "1 episode" : `${episodes} episodes`} (${
        segments === 1 ? "1 passage" : `${segments} passages`
      })`,
    zeroTitle: "Nothing matches",
    zeroBody:
      "Typos are already forgiven, so the word most likely has not been labelled yet.",
    zeroCta: "Browse all episodes",
    promptTitle: "Search for something that happened",
    reasonTopic: "TOPIC",
    reasonMoment: "MOMENT",
    /**
     * 🚨 The timestamp alone. It used to be prefixed with the word "moment" on
     * every single row, next to a badge that already says MOMENT, so a card
     * with four moments repeated the word four times for nothing.
     */
    reasonMomentAt: (timestamp: string) => timestamp,
    reasonTopicVotes: (votes: number) => ` / ${votes} votes`,
    examples: [
      "счупен хладилник",
      "баница",
      "историята с колата",
      "квантова физика",
    ] as readonly string[],
    backendNote: (backend: string) => `via ${backend}`,

    // --- Two result sections -------------------------------------------------
    /**
     * 🚨 The split is TITLE-first, then everything else. People search for a
     * title far more often than for a label, so a title hit buried under topic
     * matches reads as "not found".
     */
    inTitleHeading: "In the title",
    inTitleSubtitle: "The words appear in the episode title itself.",
    elsewhereHeading: "Everywhere else",
    elsewhereSubtitle:
      "Matched on a topic, a moment, a guest or the channel rather than the title.",
    /**
     * 🎯 Matched SOME of the words, not all of them.
     *
     * Kept, because requiring every word makes search answer "nothing matches"
     * to questions that have hundreds of real answers - people search for a
     * half-remembered phrase, not a quotation. Kept SEPARATE and named, because
     * a one-of-three-words hit presented as an equal is how the results above
     * it stop being believed.
     */
    partialHeading: "Partial matches",
    partialSubtitle:
      "These matched some of your words but not all of them, so they may be less relevant.",
    /** Sets expectations before anyone types. Coverage is real but partial. */
    scopeNote:
      "Search runs over titles, topics, moments and guests - and over the spoken words in most episodes, though not all of them.",

    // --- Spoken-word (transcript) results ------------------------------------
    /** Row badge on a passage. The timestamp is a deep link into the video. */
    reasonSaidAt: "SAID AT",
    /** Heading above episodes that matched ONLY because the words were spoken. */
    spokenHeading: "Said in the episode",
    spokenSubtitle:
      "These episodes do not mention the word in a title or topic, but it is audible in the recording.",
    /** More matches inside one episode than the card shows. */
    spokenMore: (n: number) => `+ ${n} more`,
    /** The spoken section pages independently of the label sections. */
    spokenLoadMore: "More spoken matches",
    /**
     * 🚨 Never dropped. Only ~30% of the catalogue has captions and coverage is
     * wildly channel-dependent (BFF 99%, Клюки 1%, Sport 0%), so a missing
     * episode has NOT been ruled out. Presenting this search as exhaustive
     * would be the single most misleading thing the site could claim.
     */
    spokenPartial:
      "Transcript search covers roughly a third of the episodes, so a missing episode is not ruled out.",
    /** Meilisearch is down; saying nothing would read as "never said". */
    spokenUnavailable:
      "Transcript search is unavailable right now. Only title, topic and moment matches are shown.",
  },

  channels: {
    title: "Channels",
    subtitle: (channels: number, episodes: number, rated: number) =>
      `${channels === 1 ? "1 channel" : `${channels} channels`}, ${episodes} episodes, ${rated} rated.`,
    channelCount: (n: number) => (n === 1 ? "1 channel" : `${n} channels`),
    viewGrid: "View the grid",
    handleAndCount: (handle: string, episodes: number) =>
      `${handle} / ${episodes} episodes`,
    episodeCount: (n: number) => (n === 1 ? "1 episode" : `${n} episodes`),
    subscribers: (formatted: string) => `${formatted} subscribers`,
    empty: "No channel indexed yet.",
    sparklineYear: (year: number) => `Year ${year}`,
  },

  channel: {
    gridTitle: "Ratings grid",
    hintMobile: "Rows are episodes, columns are years.",
    hintDesktop: "Rows are years, columns are the position within the year.",
    publicScore: "Public",
    eliteScore: "Elite",
    scoreModeLabel: "Score type",
    statAverage: "average score",
    statAverageElite: "elite average",
    statRated: "rated",
    statBest: "best",
    statBestYear: "best year",
    statRatings: "ratings given",
    ratedOf: (rated: number, total: number) => `${rated}/${total}`,
    seasonAverage: (average: string) => `avg ${average}`,
    recent: "Recent episodes",
    gridLabel: (channel: string) => `Ratings grid for ${channel}`,
    episodeColumn: "Episode",
    yearColumn: "Year",
    cellLabel: (title: string, score: string) => `${title}, score ${score}`,
    empty: "This channel has no dated episodes yet, so there is nothing to show.",
    legendToggle: "Legend",
    legendHide: "Hide legend",
  },

  band: {
    ...BANDS,
    unrated: "Unrated",
    provisional: "Few ratings",
    membersOnly: "Members only",
    stream: "Stream",
  },

  episode: {
    number: (n: number) => `Episode ${n}`,
    scoreLabel: "SCORE",
    outOfTen: "/10",
    rate: "Rate",
    yourRating: (score: number) => `Yours ${score}`,
    ratings: (n: number) => `${n} ratings`,
    noRatings: "no ratings yet",
    noRatingsShort: "unrated",
    elite: "Elite",
    membersOnly: "Members only",
    stream: "Stream",
    playOnYouTube: "Watch on YouTube",
    watchOnYouTube: "Watch on YouTube",
    addFirstTopic: "Add the first topic",
    /** Section heading over the topic chips. */
    topics: "Topics",
    /**
     * 🚨 Printed whenever a machine-suggested label is on screen, and never
     * softened. Every label in the catalogue today was suggested automatically
     * from titles and transcripts, and a reader who thinks a member chose them
     * reads a guess as a fact - while a member who cannot tell their own label
     * apart from a guess has no reason to add one.
     */
    topicsAutoNote:
      "Labels marked with a spark were suggested automatically. Members can add and correct them.",
    /** The marker's accessible name, on the chip itself. */
    topicAuto: "Suggested automatically",
    descriptionMore: "more",
    descriptionLess: "less",
    descriptionToggle: "Description",
    cast: "Cast",
    roleHost: "host",
    roleGuest: "guest",
    /**
     * `EpisodeParticipant.role` is a semantic key ("host" / "guest"), which is
     * the project rule: data carries keys, the component layer maps them.
     */
    role: (key: string): string => (key === "host" ? "host" : "guest"),
    moments: "Moments",
    momentsEmptyTitle: "Nothing labelled yet",
    momentsEmptyBody:
      "A timestamp plus a few words. That is what makes the episode findable later.",
    momentsEmptyCta: "Add the first moment",
    momentVotes: (n: number) => (n > 0 ? `+${n}` : String(n)),
    community: "Community ratings",
    writeReview: "Write a review",
    spoilerNotice: "Contains spoilers",
    spoilerReveal: "Show",
    spoilerHide: "Hide again",
    similar: "Similar episodes",
    similarByTopic: "by topic and cast",
    similarSameChannel: "from the same channel",
    similarTagTopic: (topic: string) => `topic: ${topic}`,
    similarTagGuest: (name: string) => `with ${name}`,
    /**
     * 🚨 Why an episode is similar, spelled out. A "similar" list that will not
     * say what it matched on is indistinguishable from a random list, and the
     * owner could not tell which it was.
     */
    similarWhySharedTopics: (n: number) =>
      n === 1 ? "1 shared topic" : `${n} shared topics`,
    similarWhySharedPeople: (n: number) =>
      n === 1 ? "1 shared guest" : `${n} shared guests`,
    similarWhySameChannel: "same channel",
    similarWhyPrefix: "Matched on",
    /**
     * 🚨 An INSTRUCTION, never a state. This read "Watched" while the episode
     * was unwatched - on a red filled button with a tick beside it - so the
     * one control that says whether you have seen something claimed you had.
     * Short on purpose: the long form pushed the last action off-screen on a
     * 390px bar, so the mobile bar takes this and the sidebar takes the long
     * one.
     */
    markWatched: "Mark watched",
    markWatchedLong: "Mark as watched",
    watchedCount: (n: number) => `Watched ${n}x`,
    logDate: "Log a date",
    favorite: "Favourite",
    unfavorite: "Unfavourite",
    watchedByYou: "Watched by you",
    watchCount: (n: number) => `${n}x`,
    watchLogEmpty:
      "No date logged yet. You can add past dates too, including rewatches.",
    removeWatch: (date: string) => `Remove ${date}`,
    yourScore: "Your score",
    noScoreYet: "-",
    notRatedNote: "not rated by you yet",
    firstRatingNote: "the first rating",
    deltaNote: (delta: string) => `${delta} against the public score`,
    changeRating: "Change",
    clearRating: "Clear",
    breakdownLabel: "Rating distribution",
    noViewData: "no view data",
    views: (formatted: string) => `${formatted} views`,
    openEpisode: "Open the episode",
    cellPosition: (year: number, index: number) => `${year} / episode ${index}`,
    provisionalNote: "Under 3 ratings, the number is not reliable yet.",
    commentsEmptyTitle: "No reviews yet",
    commentsEmptyBody: "Say what you thought. Spoilers get their own toggle.",
    commentsEmptyCta: "Write the first one",
    topicsEmptyTitle: "No topics yet",
    topicsEmptyBody:
      "Topics are shared across the whole site and collapse to one canonical name.",
    topicsEmptyCta: "Suggest a topic",
    allRatings: "See every rating",
    allRatingsHint: "Opens the channel's full ratings grid.",
    /** The moments section explains itself; an empty list otherwise says nothing. */
    momentsHowTo:
      "A moment is a timestamp plus a few words, added by the community. Tapping one opens the video at that second.",
    yourScore2: "Yours",
    communityScore: "Community",
  },

  rating: {
    sheetTitle: "Your score",
    save: "Save",
    remove: "Remove",
    compare: (publicScore: string, mine: number) =>
      `Public score ${publicScore} / yours ${mine}`,
    noPublicYet: "No public score yet.",
    pick: (n: number) => `Score ${n}`,
    saving: "Saving",
    savedToast: "Rating saved",
    removedToast: "Rating removed",
    failedToast: "The rating did not save, try again",
    retry: "Try again",
    confirmRemoveTitle: "Remove your rating?",
    confirmRemoveBody: "Your score is deleted and the episode goes back to unrated by you.",
    confirmRemoveCta: "Remove it",
    cancel: "Cancel",
  },

  watchLog: {
    sheetTitle: "When you watched it",
    sheetBody:
      "Every viewing is logged separately, including a rewatch months later.",
    quickToday: "Today",
    quickYesterday: "Yesterday",
    quickThisWeek: "This week",
    quickLastMonth: "Last month",
    pickDate: "PICK A DATE",
    recorded: (n: number) => `Logged viewings ${n}x`,
    done: "Done",
    savedToast: (date: string) => `Logged: ${date}`,
    removedToast: (date: string) => `Removed: ${date}`,
    duplicateToast: "Already logged for that date",
    futureToast: "You cannot log a future date",
    clearedToast: "Cleared from watched",
    favoriteToast: "Added to favourites",
    unfavoriteToast: "Removed from favourites",
    watchedToast: "Viewing logged",
    historyEmptyTitle: "Watch history is empty",
    historyEmptyBody:
      "Mark an episode as watched and rewatches will stack up here by date.",
    historyEmptyCta: "Browse the episodes",
    confirmClearTitle: "Remove from watched?",
    confirmClearBody: "Every logged date for this episode is deleted.",
    confirmClearCta: "Remove it",
    cancel: "Cancel",
    toggleOffHint: "Tap a logged date again to remove it.",
  },

  browse: {
    title: "Episodes",
    showing: (shown: number, total: number) => `showing ${shown} of ${total}`,
    filters: "Filters",
    filtersWithCount: (n: number) => `Filters ${n}`,
    clear: "Clear",
    clearFilters: "Clear the filters",
    apply: (n: number) => `Show ${n} episodes`,
    loadMore: "Load more",
    loading: "Loading",
    emptyTitle: "Nothing matches the filters",
    emptyBody: (summary: string) => `Active: ${summary}.`,
    emptyFallbackSummary: "a few filters",
    removeFilter: (label: string) => `Remove the ${label} filter`,
    groupSort: "SORT",
    groupKind: "KIND",
    groupYear: "YEAR",
    groupChannel: "CHANNEL",
    groupPerson: "GUEST",
    chipYear: "year",
    chipKind: "kind",
    chipChannel: "channel",
    chipPerson: "with",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    sortTop: "Top rated",
    sortLowest: "Lowest rated",
    sortMostRated: "Most rated",
    kindVideo: "Video",
    kindStream: "Stream",
    channelFilterLabel: (name: string) => `Filter by ${name}`,
    /** Joins the active filter names in the empty state: "kind and channel". */
    andJoiner: " and ",
  },

  profile: {
    memberBadge: "Member",
    statRatings: "ratings",
    statWatched: "watched",
    statFavorites: "favourites",
    histogramTitle: "How you rate",
    histogramNote: (average: string, delta: string) =>
      `Your average is ${average}, which is ${delta} above the site average.`,
    histogramNoteBelow: (average: string, delta: string) =>
      `Your average is ${average}, which is ${delta} below the site average.`,
    linkRatings: "My ratings",
    linkHistory: "Watch history",
    linkFavorites: "Favourites",
    linkTags: "My labels",
    linkMemberships: "My memberships",
    historyTitle: "Watch history",
    ratingsEmptyTitle: "No ratings yet",
    ratingsEmptyBody:
      "You have not rated anything yet. Every episode page has a rate button.",
    ratingsEmptyCta: "Browse the episodes",
    tagsEmptyTitle: "No personal labels",
    tagsEmptyBody: "Your own labels for episodes. Nobody else sees them.",
    tagsEmptyCta: "How it works",
    privateTag: "Private label",
    /** Shown instead of a handle while the YouTube handle is unknown. */
    noHandle: "Add a handle",
    unnamed: "Unnamed",
    editProfile: "Edit profile",
    /** The accessible name of the avatar button that opens the editor. */
    changeIcon: "Change your profile picture",
    nameLabel: "Display name",
    handleLabel: "Handle",
    handleHint: "Letters, digits and . _ - Between 3 and 30 characters.",
    save: "Save",
    cancel: "Cancel",
    savedToast: "Profile saved",
    handleTakenToast: "That handle is already taken",
    iconLabel: "Profile icon",
    iconHint: "Unlocked by how long you have been a member of each channel.",
    /** Only reachable if the catalogue is empty - a failed fetch looks the same as a void. */
    iconsComingSoon:
      "Profile icons are on the way. They unlock with the months you have on each channel.",
    /** Heading for the icons that need no membership at all. */
    iconEveryone: "Everyone",
    /**
     * 🚨 Months are COMPLETED months, so 0 is a real tier - "new member", the
     * first rung of every ladder - and must never render as "0 months".
     */
    iconTier: (months: number) => {
      if (months === 0) return "New member";
      if (months < 12) return months === 1 ? "1 month" : `${months} months`;
      const years = Math.floor(months / 12);
      const rest = months % 12;
      const yearPart = years === 1 ? "1 year" : `${years} years`;
      if (rest === 0) return yearPart;
      return `${yearPart} ${rest === 1 ? "1 month" : `${rest} months`}`;
    },
    iconLocked: (tier: string, months: number) =>
      months === 0
        ? `${tier} - join this channel to unlock`
        : `${tier} - unlocks at ${months === 1 ? "1 month" : `${months} months`}`,
  },

  /**
   * 🚨 A membership here is a CLAIM the user makes about themselves, and the
   * copy has to keep that separate from verification. Adding one earns the
   * badge and the profile icons; only an admin-verified membership makes a
   * rating count toward a channel's Elite score. Wording that blurs the two
   * would quietly promise people a vote they do not have.
   */
  memberships: {
    title: "My memberships",
    intro:
      "Add a membership for each channel you support. Your month count updates by itself on every renewal, so you only enter it once.",
    emptyTitle: "No memberships yet",
    emptyBody:
      "Add the channels you are a member of to show your badge and unlock profile icons.",
    add: "Add membership",
    addTitle: "Add membership",
    editTitle: "Edit membership",
    edit: "Edit",
    remove: "Remove",
    verified: "Verified by a moderator",
    channelLabel: "Channel",
    channelLocked: "To move a membership to another channel, remove it and add it again.",
    monthsLabel: "Months so far",
    monthsPlaceholder: "5",
    monthsHint: "The number on your membership badge right now. Just joined? Enter 0.",
    renewalLabel: "Renews on day",
    renewalPlaceholder: "6",
    renewalHint: "The day of the month you get charged. Between 1 and 31.",
    /**
     * The consequence of the two numbers, before saving. It is the one place a
     * typo is catchable: "71 from the 6th" is obviously wrong to someone who
     * meant 17, in a way that "17" sitting in a box is not.
     */
    preview: (months: number, next: number, day: number) =>
      months === 0
        ? `You are a new member now, and 1 month from the ${ordinal(day)} of next month.`
        : `You have ${months === 1 ? "1 month" : `${months} months`} now, and ${next} from the ${ordinal(day)} of next month.`,
    monthsAndRenewal: (months: number, renews: string) =>
      `${months === 1 ? "1 month" : `${months} months`} - renews ${renews}`,
    needsDetails: "Add your month count",
    savedToast: "Membership saved",
    removedToast: "Membership removed",
  },

  leaderboard: {
    title: "Leaderboard",
    kindTop: "Highest",
    kindElite: "Elite",
    kindMostRated: "Most rated",
    rank: (n: number) => `${n}`,
    ratings: (n: number) => `${n} ratings`,
    empty: "Not enough ratings for a leaderboard yet.",
  },

  status: {
    title: "Status",
    healthy: "Everything works",
    degraded: "Degraded",
    unreachable: "The API is not responding",
    checkedAt: (relative: string) => relative,
    dependencyOk: "ok",
    dependencyDown: "not responding",
    database: "Database",
    redis: "Redis",
    recheck: "Check again",
    rechecking: "Checking",
    recheckSucceeded: "The API responds.",
    recheckDegraded: "The API responded, but a dependency is down.",
    recheckFailed: "The API is not responding.",
    unreachableHint:
      "Start the API with `uv run python manage.py runserver` in apps/api and check again.",
    redisDegradedToast: "Redis is down, everything else works",
  },

  notFound: {
    code: "404",
    title: "No such page",
    body: "If you followed an old link, search will probably find the episode.",
    searchCta: "Search for an episode",
    backHome: "Back to the start",
    browseEpisodes: "Browse the episodes",
  },

  auth: {
    signInTitle: "Sign in to rate",
    signInBody:
      "Ratings, viewings and favourites are saved to your profile. Signing in takes a second.",
    signIn: "Sign in",
    signOut: "Sign out",
    later: "Later",
    signedOutToast: "Sign in to save this",
  },

  install: {
    title: "Add as an app",
    body: "The site installs straight from the browser - an icon on your home screen and full-screen launch, with no app store.",
    androidTitle: "Android (Chrome)",
    androidSteps: [
      "Open the three-dot menu at the top right",
      'Choose "Add to Home screen"',
      'Confirm with "Install"',
    ] as readonly string[],
    iosTitle: "iPhone and iPad (Safari)",
    iosSteps: [
      "Tap the share button - the square with an upward arrow, in the middle of the bottom bar",
      'Scroll the list and choose "Add to Home Screen"',
      'Confirm with "Add" at the top right',
    ] as readonly string[],
    desktopTitle: "Desktop (Chrome and Edge)",
    desktopSteps: [
      "Click the install icon at the right-hand end of the address bar",
      'Confirm with "Install"',
    ] as readonly string[],
  },

  errors: {
    generic: "Something went wrong. Try again.",
    network: "The API is not responding. Check that it is running.",
    timeout: "The API took too long.",
    notFound: "We could not find what you are looking for.",
    unauthorized: "You need to sign in to do that.",
    forbidden: "You do not have permission for that.",
    rateLimited: "Too many requests. Slow down a little.",
    server: "The API returned an error.",
    parse: "The API returned a response we cannot read.",
  },

  common: {
    loading: "Loading",
    retry: "Try again",
    dismiss: "Dismiss",
    unknown: "No data",
    close: "Close",
    back: "Back",
    open: "Open",
    more: "more",
    cancel: "Cancel",
    separator: ".",
    months: MONTHS_EN,
  },
};

/** The shape every dictionary must satisfy. */
export type Copy = typeof en;

// ---------------------------------------------------------------------------
// Bulgarian
// ---------------------------------------------------------------------------

const bg: Copy = {
  app: {
    name: "Comedy Club Community",
    shortName: "Comedy Club",
    tagline: "Всеки епизод. Всеки момент. Намираем.",
    description:
      "Общностен индекс на български подкаст епизоди. Търси по теми, моменти и гости, оценявай и си води списък какво си гледал.",
  },

  nav: {
    homeLink: "Начало",
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
    settings: "Настройки",
    openSettings: "Отвори настройките",
  },

  settings: {
    title: "Настройки",
    description: "Запазва се на това устройство.",
    appearance: "Изглед",
    appearanceHint: "Тъмната тема е по подразбиране.",
    themeDark: "Тъмна",
    themeLight: "Светла",
    language: "Език",
    languageHint:
      "Само интерфейсът. Заглавията, темите и транскриптите остават на български.",
    languageEn: "English",
    languageBg: "Български",
    done: "Готово",
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
    trigger: "Търси момент, тема или реплика",
    title: "Търси нещо, което се е случило",
    subtitle:
      "Не само заглавия. Търсенето минава през теми, моменти, гости и това, което наистина е казано в епизода.",
    suggestions: "ПРЕДЛОЖЕНИЯ",
    recent: "СКОРОШНИ",
    inputLabel: "Търсене в епизодите",
    submit: "Търси",
    close: "Затвори",
    clear: "Изчисти",
    resultsFor: (query: string) => `Резултати за „${query}“`,
    summaryLabelled: (n: number) =>
      n === 1
        ? "1 епизод съвпада по заглавие, тема или гост"
        : `${n} епизода съвпадат по заглавие, тема или гост`,
    summaryLabelledSplit: (full: number, partial: number) =>
      `${full === 1 ? "1 епизод съвпада" : `${full} епизода съвпадат`} с всички твои думи, още ${partial} съвпадат с част от тях`,
    summarySpoken: (episodes: number, segments: number) =>
      `Казано в ${episodes === 1 ? "1 епизод" : `${episodes} епизода`} (${
        segments === 1 ? "1 реплика" : `${segments} реплики`
      })`,
    zeroTitle: "Нищо не съвпада",
    zeroBody:
      "Правописните грешки вече се прощават, така че думата най-вероятно още не е отбелязана.",
    zeroCta: "Разгледай всички епизоди",
    promptTitle: "Търси нещо, което се е случило",
    reasonTopic: "ТЕМА",
    reasonMoment: "МОМЕНТ",
    reasonMomentAt: (timestamp: string) => timestamp,
    reasonTopicVotes: (votes: number) => ` / ${votes} гласа`,
    examples: [
      "счупен хладилник",
      "баница",
      "историята с колата",
      "квантова физика",
    ] as readonly string[],
    backendNote: (backend: string) => `via ${backend}`,

    inTitleHeading: "В заглавието",
    inTitleSubtitle: "Думите се срещат в самото заглавие на епизода.",
    elsewhereHeading: "Навсякъде другаде",
    elsewhereSubtitle:
      "Съвпадение по тема, момент, гост или канал, а не по заглавие.",
    partialHeading: "Частични съвпадения",
    partialSubtitle:
      "Тези съвпадат с част от думите ти, но не с всички - възможно е да са по-малко подходящи.",
    scopeNote:
      "Търсенето минава през заглавия, теми, моменти и гости - и през казаното в повечето епизоди, макар и не във всички.",

    reasonSaidAt: "КАЗАНО В",
    spokenHeading: "Казано в епизода",
    spokenSubtitle:
      "Тези епизоди не споменават думата в заглавие или тема - но тя се чува в записа.",
    spokenMore: (n: number) => `+ още ${n}`,
    spokenLoadMore: "Още съвпадения в записа",
    spokenPartial:
      "Търсенето в записа покрива около една трета от епизодите, така че липсващ епизод не е изключен.",
    spokenUnavailable:
      "Търсенето в записа не е достъпно в момента. Показани са само съвпадения по заглавие, тема и момент.",
  },

  channels: {
    title: "Канали",
    subtitle: (channels: number, episodes: number, rated: number) =>
      `${channels === 1 ? "1 канал" : `${channels} канала`}, ${episodes} епизода, ${rated} оценени.`,
    channelCount: (n: number) => (n === 1 ? "1 канал" : `${n} канала`),
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
    legendToggle: "Легенда",
    legendHide: "Скрий легендата",
  },

  band: {
    ...BANDS,
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
    descriptionToggle: "Описание",
    topics: "Теми",
    topicsAutoNote:
      "Етикетите с искра са предложени автоматично. Членовете могат да ги добавят и поправят.",
    topicAuto: "Предложен автоматично",
    cast: "Участници",
    roleHost: "домакин",
    roleGuest: "гост",
    role: (key: string): string => (key === "host" ? "домакин" : "гост"),
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
    similarWhySharedTopics: (n: number) =>
      n === 1 ? "1 обща тема" : `${n} общи теми`,
    similarWhySharedPeople: (n: number) =>
      n === 1 ? "1 общ гост" : `${n} общи гости`,
    similarWhySameChannel: "същия канал",
    similarWhyPrefix: "Съвпада по",
    markWatched: "Отбележи",
    markWatchedLong: "Отбележи като гледано",
    watchedCount: (n: number) => `Гледано ${n}x`,
    logDate: "Запиши дата",
    favorite: "Любими",
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
    allRatings: "Виж всички оценки",
    allRatingsHint: "Отваря пълната решетка на оценките за канала.",
    momentsHowTo:
      "Моментът е час плюс няколко думи, добавени от общността. Натискането отваря видеото на тази секунда.",
    yourScore2: "Твоята",
    communityScore: "Общността",
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
    confirmRemoveTitle: "Да премахнем ли оценката?",
    confirmRemoveBody: "Оценката ти се изтрива и епизодът остава без твоя оценка.",
    confirmRemoveCta: "Премахни",
    cancel: "Отказ",
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
    removedToast: (date: string) => `Премахнато: ${date}`,
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
    confirmClearTitle: "Да го махнем ли от гледаните?",
    confirmClearBody: "Всички записани дати за този епизод се изтриват.",
    confirmClearCta: "Премахни",
    cancel: "Отказ",
    toggleOffHint: "Натисни записана дата пак, за да я премахнеш.",
  },

  browse: {
    title: "Епизоди",
    showing: (shown: number, total: number) => `показани ${shown} от ${total}`,
    filters: "Филтри",
    filtersWithCount: (n: number) => `Филтри ${n}`,
    clear: "Изчисти",
    clearFilters: "Изчисти филтрите",
    apply: (n: number) => `Покажи ${n} епизода`,
    loadMore: "Зареди още",
    loading: "Зарежда се",
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
    channelFilterLabel: (name: string) => `Филтрирай по ${name}`,
    andJoiner: " и ",
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
    linkMemberships: "Моите членства",
    historyTitle: "История на гледане",
    ratingsEmptyTitle: "Още няма оценки",
    ratingsEmptyBody:
      "Още не си оценил нищо. Всяка страница на епизод има бутон за оценка.",
    ratingsEmptyCta: "Разгледай епизодите",
    tagsEmptyTitle: "Няма лични етикети",
    tagsEmptyBody: "Твои собствени етикети за епизоди. Никой друг не ги вижда.",
    tagsEmptyCta: "Как работи",
    privateTag: "Личен етикет",
    noHandle: "Добави handle",
    unnamed: "Без име",
    editProfile: "Редактирай профила",
    changeIcon: "Смени снимката на профила си",
    nameLabel: "Име за показване",
    handleLabel: "Handle",
    handleHint: "Букви, цифри и . _ - Между 3 и 30 знака.",
    save: "Запази",
    cancel: "Отказ",
    savedToast: "Профилът е запазен",
    handleTakenToast: "Този handle вече е зает",
    iconLabel: "Икона на профила",
    iconHint: "Отключва се според това колко дълго си член на всеки канал.",
    iconsComingSoon:
      "Иконите за профил идват скоро. Отключват се според месеците, които имаш във всеки канал.",
    iconEveryone: "За всички",
    iconTier: (months: number) => {
      if (months === 0) return "Нов член";
      if (months < 12) return months === 1 ? "1 месец" : `${months} месеца`;
      const years = Math.floor(months / 12);
      const rest = months % 12;
      const yearPart = years === 1 ? "1 година" : `${years} години`;
      if (rest === 0) return yearPart;
      return `${yearPart} и ${rest === 1 ? "1 месец" : `${rest} месеца`}`;
    },
    iconLocked: (tier: string, months: number) =>
      months === 0
        ? `${tier} - стани член на канала, за да я отключиш`
        : `${tier} - отключва се на ${months === 1 ? "1 месец" : `${months} месеца`}`,
  },

  memberships: {
    title: "Моите членства",
    intro:
      "Добави членство за всеки канал, който подкрепяш. Броят месеци се обновява сам при всяко подновяване, така че го въвеждаш само веднъж.",
    emptyTitle: "Още няма членства",
    emptyBody:
      "Добави каналите, в които си член, за да покажеш значката си и да отключиш икони за профила.",
    add: "Добави членство",
    addTitle: "Добави членство",
    editTitle: "Редактирай членството",
    edit: "Редактирай",
    remove: "Премахни",
    verified: "Потвърдено от модератор",
    channelLabel: "Канал",
    channelLocked:
      "За да преместиш членство в друг канал, премахни го и го добави наново.",
    monthsLabel: "Месеци досега",
    monthsPlaceholder: "5",
    monthsHint:
      "Числото на значката ти за членство в момента. Тъкмо си станал член? Въведи 0.",
    renewalLabel: "Подновява се на",
    renewalPlaceholder: "6",
    renewalHint: "Денят от месеца, в който ти се таксува. Между 1 и 31.",
    // 🇧🇬 "на 6-о число", not an English-style ordinal suffix - Bulgarian
    // ordinals inflect and are never written "6th". See `ordinal` above.
    preview: (months: number, next: number, day: number) =>
      months === 0
        ? `Сега си нов член, а от ${day}-о число на следващия месец - 1 месец.`
        : `Сега имаш ${months === 1 ? "1 месец" : `${months} месеца`}, а от ${day}-о число на следващия месец - ${next}.`,
    monthsAndRenewal: (months: number, renews: string) =>
      `${months === 1 ? "1 месец" : `${months} месеца`} - подновява се на ${renews}`,
    needsDetails: "Добави броя месеци",
    savedToast: "Членството е запазено",
    removedToast: "Членството е премахнато",
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
    signOut: "Излез от профила",
    later: "По-късно",
    signedOutToast: "Влез, за да запазиш това",
  },

  install: {
    title: "Добави като приложение",
    body: "Сайтът се инсталира направо от браузъра - икона на началния екран и отваряне на цял екран, без магазин за приложения.",
    androidTitle: "Android (Chrome)",
    androidSteps: [
      "Отвори менюто с трите точки горе вдясно",
      "Избери „Добавяне към началния екран“",
      "Потвърди с „Инсталиране“",
    ] as readonly string[],
    iosTitle: "iPhone и iPad (Safari)",
    iosSteps: [
      "Натисни бутона за споделяне - квадратчето със стрелка нагоре, в средата на лентата долу",
      "Превърти списъка и избери „Добавяне към начален екран“",
      "Потвърди с „Добавяне“ горе вдясно",
    ] as readonly string[],
    desktopTitle: "Компютър (Chrome и Edge)",
    desktopSteps: [
      "Кликни иконата за инсталиране в десния край на адресната лента",
      "Потвърди с „Инсталиране“",
    ] as readonly string[],
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
    cancel: "Отказ",
    separator: ".",
    months: MONTHS_BG,
  },
};

export const dictionaries: Record<Locale, Copy> = { en, bg };

export function getDictionary(locale: Locale): Copy {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

/**
 * The default (English) dictionary, as a plain object.
 *
 * Kept as a named export for two callers that cannot use the React context:
 * `tests/copy.spec.ts`, which reads the shape off disk, and non-React modules
 * such as `lib/api/client.ts`. Components must NOT import this - they read
 * `useCopy()` or `getCopy()` so the locale is respected.
 */
export const copy = en;

/**
 * The dictionary non-React modules should read.
 *
 * `lib/api/client.ts` builds `ApiError.userMessage` far from any component, so
 * it has no context to read. `LocaleProvider` points this at the active
 * dictionary on the client; on the server it stays English, which is correct
 * because the server render IS the default locale.
 */
let activeDictionary: Copy = en;

export function setActiveDictionary(next: Copy): void {
  activeDictionary = next;
}

export function getActiveDictionary(): Copy {
  return activeDictionary;
}
