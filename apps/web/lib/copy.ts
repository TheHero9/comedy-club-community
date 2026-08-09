/**
 * Every user-facing string in the web app lives here.
 *
 * Project rule: never hardcode a user-facing string inside a component.
 * UI chrome is English; episode content and community labels stay Bulgarian.
 * Keeping the whole surface in one object is the insurance policy that turns a
 * future BG/EN toggle into a one-day job instead of a two-week one.
 *
 * Conventions:
 * - Keys are grouped by surface (app, nav, home, health, errors, common).
 * - No emoji. Icons come from lucide-react at the component layer.
 * - Values are plain sentences. Use functions when a value needs interpolation.
 */
export const copy = {
  app: {
    name: "Comedy Club Community",
    shortName: "Comedy Club",
    tagline: "Every episode, every channel, actually searchable.",
    description:
      "A searchable community hub for Bulgarian YouTube podcast channels. Browse every episode, rate it, log what you watched, and label what happened.",
  },

  nav: {
    // Accessible name for the logo link. The wordmark beside the icon is hidden
    // under the `sm` breakpoint, and the icon is decorative, so without this the
    // link is focusable with nothing to announce on a phone.
    homeLink: "Comedy Club Community - home",
    home: "Home",
    channels: "Channels",
    episodes: "Episodes",
    search: "Search",
    profile: "Profile",
    signIn: "Sign in",
    signOut: "Sign out",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  home: {
    heading: "Comedy Club Community",
    subheading:
      "The foundation is up. Browsing, ratings and search arrive in the next waves.",
    systemSectionTitle: "System status",
  },

  health: {
    cardTitle: "API status",
    cardDescription: "Live reachability of the Django API and its dependencies.",
    checkedAt: (isoTimestamp: string) => `Checked at ${isoTimestamp}`,
    endpointLabel: "Endpoint",
    overallHealthy: "All systems operational",
    overallDegraded: "Degraded",
    overallUnreachable: "API unreachable",
    dependencies: {
      database: "PostgreSQL",
      redis: "Redis",
    },
    dependencyUp: "Up",
    dependencyDown: "Down",
    recheck: "Recheck",
    rechecking: "Rechecking",
    recheckSucceeded: "API is reachable.",
    recheckDegraded: "API answered, but a dependency is down.",
    recheckFailed: "Could not reach the API.",
    unreachableHint:
      "Start the API with `uv run python manage.py runserver` inside apps/api, then recheck.",
  },

  errors: {
    generic: "Something went wrong. Please try again.",
    network: "Could not reach the API. Check that it is running.",
    timeout: "The API took too long to respond.",
    notFound: "We could not find what you were looking for.",
    unauthorized: "You need to sign in to do that.",
    forbidden: "You do not have permission to do that.",
    rateLimited: "Too many requests. Please slow down.",
    server: "The API returned an error.",
    parse: "The API returned a response we could not read.",
  },

  common: {
    loading: "Loading",
    retry: "Retry",
    dismiss: "Dismiss",
    unknown: "Unknown",
  },

  notFound: {
    code: "404",
    title: "Page not found",
    body: "This page does not exist. The episode or channel may have been removed from YouTube, or the link may be mistyped.",
    backHome: "Back to home",
    browseEpisodes: "Browse episodes",
  },

  grid: {
    title: "Ratings grid",
    subtitle: "One calendar year is one season. Each cell is an episode.",
    caption: (channel: string) =>
      `Episode ratings for ${channel}, one row per year`,
    episodeColumn: "Episode number within the year",
    yearColumn: "Year",
    averageRow: "AVG",
    seasonAverage: (average: string) => `${average} avg`,
    notRated: "Not rated",
    provisional: "Few ratings",
    membersOnly: "Members only",
    stream: "Live stream",
    empty: "No dated episodes yet, so there is nothing to chart.",
    publicScore: "Public",
    eliteScore: "Elite",
    eliteHint: "Elite scores count only verified members of this channel.",
    ratedOf: (rated: number, total: number) => `${rated} of ${total} episodes rated`,
  },

  episode: {
    watchOnYouTube: "Watch on YouTube",
    membersOnly: "Members only",
    stream: "Live stream",
    notRated: "Not rated yet",
    ratings: (n: number) => (n === 1 ? "1 rating" : `${n} ratings`),
    publicScore: "Public score",
    eliteScore: "Elite score",
    topics: "Topics",
    moments: "Moments",
    comments: "Comments",
    noTopics: "No topics yet.",
    noMoments: "No moments yet.",
    noComments: "No comments yet.",
    spoiler: "Spoiler - tap to reveal",
    description: "Description",
    noDescription: "This episode has no description.",
    /**
     * Compact elite-score chip on an episode card. It carries its own label
     * because the card has no room for an icon: a lucide SVG costs ~620 bytes
     * of inline markup per card, and 24 cards make that the page's problem.
     */
    eliteChip: (score: string) => `Elite ${score}`,
  },

  channels: {
    title: "Channels",
    subtitle: "Every podcast channel tracked here.",
    episodeCount: (n: number) => (n === 1 ? "1 episode" : `${n} episodes`),
    channelCount: (n: number) => (n === 1 ? "1 channel" : `${n} channels`),
    browseAll: "Browse all episodes",
  },

  episodes: {
    title: "Episodes",
    subtitle: "Every episode across every channel.",
    empty: "No episodes match these filters.",
    loadMore: "Load more",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    sortTop: "Top rated",
    sortTopElite: "Top elite",
    sortMostRated: "Most rated",
    filterAll: "All",
    filterVideos: "Videos",
    filterStreams: "Streams",
    filterMembers: "Members only",
    showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    showingRange: (from: number, to: number, total: number) =>
      `Showing ${from} to ${to} of ${total}`,
  },

  pagination: {
    label: "Pagination",
    previous: "Previous",
    next: "Next",
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
  },

  search: {
    title: "Search",
    placeholder: "Search episodes, topics, moments...",
    subtitle: "Typo-tolerant and Bulgarian-aware.",
    empty: "Nothing matched that search.",
    prompt: "Type to search across every episode.",
    results: (n: number) => (n === 1 ? "1 result" : `${n} results`),
    matchedTopics: "Matched topics",
    matchedMoments: "Matched moments",
    poweredBy: (backend: string) => `via ${backend}`,
  },

} as const;

export type Copy = typeof copy;
