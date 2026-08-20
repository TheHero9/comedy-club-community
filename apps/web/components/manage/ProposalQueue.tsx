"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { PersonPicker } from "@/components/shared/PersonPicker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/client";
import type { Person, ProposalQueueItem } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";
import { formatDate } from "@/lib/format";

/** How many decided proposals the history shows. It is a recent record, not an audit log. */
const HISTORY_LIMIT = 30;

/**
 * The seed page handed to every persona picker, which is also the API's hard
 * `MAX_LIMIT`.
 *
 * ⚠️ It is only a SEED now. `PersonPicker` carries its own search and states
 * its own cap, so this list exists to make the panel non-empty the instant it
 * opens - reaching past 100 personas is the picker's job, not this query's.
 */
const PICKER_LIMIT = 100;

/**
 * The review queue, grouped into SUBMISSIONS rather than rows.
 *
 * 🚨 The owner's report: "what people will do is suggest like 5 people for one
 * episode, so I should see them as a batch - these people suggested these 5
 * people for this episode - not five separate things." A flat list is five
 * independent-looking decisions about one act, and it buries the fact that they
 * are all the same episode, which is the context that makes them reviewable at
 * all.
 *
 * Grouped by episode AND proposer, not episode alone: two members suggesting
 * different casts for the same episode are two judgements, and merging them
 * would hide a disagreement behind an "approve all".
 */
export function ProposalQueue() {
  const copy = useCopy();
  const queryClient = useQueryClient();

  /**
   * 🚨 UNFILTERED, and separate from the roster above it. There used to be a
   * filter box on this page feeding every dropdown at once, which meant
   * searching for one persona emptied every OTHER row's picker - a moderator
   * looking someone up silently lost the ability to approve anyone else. Each
   * picker now searches inside itself, so the shared query went back to being
   * one plain first page.
   */
  const people = useQuery({
    queryKey: ["manage", "picker-people"],
    queryFn: () =>
      viewerApi.get<Person[]>("/api/people", {
        query: { limit: PICKER_LIMIT },
        cache: "no-store",
      }),
  });

  const pickerPeople = people.data ?? [];

  const queue = useQuery({
    queryKey: ["manage", "proposals"],
    queryFn: () =>
      viewerApi.get<ProposalQueueItem[]>(
        "/api/moderation/participant-proposals",
        { cache: "no-store" },
      ),
  });

  const history = useQuery({
    queryKey: ["manage", "proposal-history"],
    queryFn: () =>
      viewerApi.get<ProposalQueueItem[]>(
        "/api/moderation/participant-proposals/reviewed",
        { query: { limit: HISTORY_LIMIT }, cache: "no-store" },
      ),
  });

  // 🚨 Both lists, always. An approval that vanishes from the queue and appears
  // nowhere else is exactly what the owner hit: "I click approve, it's approved
  // - and I should have some history of what was approved, but I see no history
  // at all." Invalidating only the queue would rebuild that hole.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["manage", "proposals"] });
    queryClient.invalidateQueries({ queryKey: ["manage", "proposal-history"] });
  };

  const batches = groupIntoSubmissions(queue.data ?? []);

  return (
    <>
      <h2 className="mt-10 text-[15px] font-semibold">{copy.manage.queueTitle}</h2>

      {queue.isLoading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : batches.length === 0 ? (
        <p className="mt-2 text-small text-subtle-foreground">{copy.manage.queueEmpty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {batches.map((batch) => (
            <SubmissionCard
              key={batch.key}
              batch={batch}
              people={pickerPeople}
              onDone={refresh}
            />
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-[15px] font-semibold">{copy.manage.historyTitle}</h2>
      {history.isLoading ? (
        <Skeleton className="mt-3 h-16 w-full" />
      ) : (history.data ?? []).length === 0 ? (
        <p className="mt-2 text-small text-subtle-foreground">{copy.manage.historyEmpty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {(history.data ?? []).map((proposal) => (
            <HistoryRow key={proposal.id} proposal={proposal} />
          ))}
        </ul>
      )}
    </>
  );
}

interface Submission {
  key: string;
  episodeTitle: string;
  episodeYoutubeId: string;
  proposedBy: string | null;
  items: ProposalQueueItem[];
}

/**
 * One member's suggestions for one episode, in arrival order.
 *
 * The API returns newest first, and grouping preserves whichever order the rows
 * arrived in - so a batch reads top to bottom the way it was typed rather than
 * backwards.
 */
function groupIntoSubmissions(proposals: ProposalQueueItem[]): Submission[] {
  const batches = new Map<string, Submission>();

  for (const proposal of proposals) {
    const key = `${proposal.episode_youtube_id}::${proposal.proposed_by ?? ""}`;
    const existing = batches.get(key);
    if (existing) {
      existing.items.push(proposal);
      continue;
    }
    batches.set(key, {
      key,
      episodeTitle: proposal.episode_title,
      episodeYoutubeId: proposal.episode_youtube_id,
      proposedBy: proposal.proposed_by ?? null,
      items: [proposal],
    });
  }

  return [...batches.values()];
}

function SubmissionCard({
  batch,
  people,
  onDone,
}: {
  batch: Submission;
  people: Person[];
  onDone: () => void;
}) {
  const copy = useCopy();

  /**
   * The persona chosen for each proposal, keyed by id.
   *
   * Pre-filled from the proposal where the member picked an existing persona;
   * empty where they typed a name, which is precisely where a human decision is
   * required. Held here rather than in each row so "approve all" can read every
   * choice without lifting state twice.
   */
  const [slugs, setSlugs] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      batch.items.map((item) => [item.id, item.person_slug ?? ""]),
    ),
  );
  /**
   * What each picker's trigger reads.
   *
   * Held beside the slug rather than looked up in `people`: the picker searches
   * the server, so the chosen persona is routinely not in the seed page, and a
   * lookup that misses would blank a trigger the moderator had just set.
   */
  const [names, setNames] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      batch.items
        .filter((item) => item.person_slug)
        .map((item) => [item.id, item.display_name]),
    ),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: async ({
      ids,
      action,
    }: {
      ids: number[];
      action: "approve" | "reject";
    }) => {
      // Sequential, not Promise.all. These are writes behind a shared write
      // throttle, and a burst of five is the shape most likely to trip it -
      // which would leave the batch half-applied with no way to tell which half.
      for (const id of ids) {
        await viewerApi.post(
          `/api/moderation/participant-proposals/${id}/${action}`,
          action === "approve" ? { person_slug: slugs[id], note } : { note },
        );
      }
    },
    onSuccess: (_data, variables) => {
      notify.success(
        variables.action === "approve" ? copy.manage.approved : copy.manage.rejected,
      );
      onDone();
    },
    onError: (caught) =>
      setError(isApiError(caught) ? caught.userMessage : copy.errors.generic),
  });

  const ready = batch.items.every((item) => slugs[item.id]);

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-small font-semibold">{batch.episodeTitle}</span>
        <span className="rounded-pill border border-border px-2 py-0.5 text-[11px] text-subtle-foreground">
          {copy.manage.queueBatch(batch.items.length)}
        </span>
        {batch.proposedBy ? (
          <span className="text-[11.5px] text-faint-foreground">
            {copy.manage.queueProposedBy} {batch.proposedBy}
          </span>
        ) : null}
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {batch.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-end gap-2 rounded-lg bg-elevated px-2.5 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-small font-semibold">{item.display_name}</span>
              <span className="block text-[11.5px] text-subtle-foreground">
                {copy.episode.role(item.role)}
                {item.proposed_name ? ` · ${copy.manage.queueTyped}` : ""}
              </span>
            </span>

            <span className="flex min-w-[190px] flex-1 flex-col gap-1">
              <span className="text-[12px] text-subtle-foreground">
                {copy.manage.queueApproveAs}
              </span>
              {/* 🚨 Our own dropdown, not a native `<select>`. The list is
                  paged at 100 on the server, so a select could not reach past
                  the first page at all - and on a phone it handed the choice
                  to the operating system's wheel, which shows no avatar and
                  cannot be searched. */}
              <PersonPicker
                aria-label={copy.manage.queueApproveAs}
                value={slugs[item.id] ?? ""}
                valueLabel={names[item.id] ?? item.display_name}
                initialPeople={people}
                onSelect={(person) => {
                  setSlugs((current) => ({ ...current, [item.id]: person.slug }));
                  setNames((current) => ({ ...current, [item.id]: person.name }));
                }}
              />
            </span>

            <div className="flex gap-1.5">
              <Button
                size="sm"
                disabled={review.isPending}
                onClick={() => {
                  setError(null);
                  if (!slugs[item.id]) {
                    // The API refuses this too; saying so here saves a round
                    // trip and explains WHY nothing happened.
                    setError(copy.manage.queuePickPerson);
                    return;
                  }
                  review.mutate({ ids: [item.id], action: "approve" });
                }}
              >
                <Check className="h-4 w-4" />
                {copy.manage.queueApprove}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={review.isPending}
                onClick={() => {
                  setError(null);
                  review.mutate({ ids: [item.id], action: "reject" });
                }}
              >
                <X className="h-4 w-4" />
                {copy.manage.queueReject}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[190px] flex-1 flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">
            {copy.manage.queueRejectNote}
          </span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          />
        </label>

        {/* Only offered for a real batch. On a single suggestion it would be a
            second button doing exactly what the first one does. */}
        {batch.items.length > 1 ? (
          <Button
            size="sm"
            // 🚨 Disabled until EVERY row has a persona. A partial "approve
            // all" would apply some and 422 the rest, and the queue would then
            // show the leftovers with no sign that the others went through.
            disabled={!ready || review.isPending}
            title={ready ? undefined : copy.manage.queueApproveAllHint}
            onClick={() => {
              setError(null);
              review.mutate({
                ids: batch.items.map((item) => item.id),
                action: "approve",
              });
            }}
          >
            <Check className="h-4 w-4" />
            {copy.manage.queueApproveAll}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-primary-text">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** One decided proposal: what, for which episode, by whom, and when. */
function HistoryRow({ proposal }: { proposal: ProposalQueueItem }) {
  const copy = useCopy();
  const approved = proposal.status === "approved";

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-border px-3 py-2">
      <span
        className={
          approved
            ? "rounded-pill border border-border px-2 py-0.5 text-[11px] text-gold"
            : "rounded-pill border border-border px-2 py-0.5 text-[11px] text-subtle-foreground"
        }
      >
        {approved ? copy.manage.historyApproved : copy.manage.historyRejected}
      </span>
      <span className="text-small font-semibold">{proposal.display_name}</span>
      <span className="text-[11.5px] text-subtle-foreground">
        {copy.episode.role(proposal.role)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint-foreground">
        {proposal.episode_title}
      </span>
      {proposal.reviewed_by ? (
        <span className="text-[11.5px] text-faint-foreground">
          {copy.manage.historyBy(proposal.reviewed_by)}
        </span>
      ) : null}
      {/* 🚨 `copy.common.months` passed explicitly. `formatDate` takes the month names
          as a required parameter because a module-level import resolves once
          per process, which would serve a Bulgarian viewer English months in
          the server HTML and Bulgarian ones after hydration. */}
      <span className="font-mono text-[11px] text-faint-foreground tabular">
        {formatDate(proposal.verified_at, copy.common.months)}
      </span>
    </li>
  );
}
