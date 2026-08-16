"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { MembershipEditor } from "@/components/profile/MembershipEditor";
import { SignedOutNotice } from "@/components/profile/SignedOutNotice";
import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { Page } from "@/components/shell/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import type { Channel, Membership } from "@/lib/api/podcast";
import { listChannels } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";
import { formatDate } from "@/lib/format";

/**
 * Managing your channel memberships.
 *
 * 🚨 THE MONTH COUNT IS NOT SOMETHING THIS PAGE STORES. The user types "70
 * months, renews on the 6th" once; the API turns that into the start date it
 * implies and counts forward on every read. So this page never has to be
 * revisited to stay accurate, and there is no nightly job whose failure would
 * quietly corrupt everyone's badge. See `podcast/services/memberships.py`.
 *
 * 🚨 A membership here is a CLAIM, and the page says so. Adding one earns the
 * badge and unlocks profile icons; it does not make the user's ratings count
 * toward a channel's Elite score - that still needs an admin to verify, and
 * pretending otherwise would quietly let anyone vote themselves into the elite
 * average. (Owner ruling, 2026-08-16: "for now badges".)
 */
export default function MembershipsPage() {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const { signedIn } = useViewerAuth();
  const [editing, setEditing] = useState<Membership | null>(null);
  const [adding, setAdding] = useState(false);

  const memberships = useQuery({
    queryKey: ["me", "memberships"],
    enabled: signedIn,
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<Membership[]>("/api/me/memberships", {
        signal,
        cache: "no-store",
      }),
  });

  // The channel roster is public and tiny (7 rows), so it is fetched up front
  // rather than when the form opens - the picker is the first thing in that
  // sheet and a spinner there would be the whole content.
  const channels = useQuery({
    queryKey: ["channels"],
    enabled: signedIn,
    retry: false,
    queryFn: () => listChannels(),
  });

  const remove = useMutation({
    mutationFn: (membership: Membership) =>
      viewerApi.delete(`/api/me/memberships/${membership.id}`),
    onSuccess: async () => {
      // 🚨 `me` too, not just the list. The profile header renders the member
      // badge and the avatar from the same memberships, so invalidating only
      // this page's query would leave a badge for a membership just deleted.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["me", "memberships"] }),
      ]);
      notify.success(copy.memberships.removedToast);
    },
    onError: () => notify.error(copy.errors.generic),
  });

  if (!signedIn || memberships.isError) {
    return (
      <Page>
        <h1 className="text-h1">{copy.memberships.title}</h1>
        <div className="mt-5">
          <SignedOutNotice />
        </div>
      </Page>
    );
  }

  const rows = memberships.data ?? [];
  const roster: Channel[] = channels.data ?? [];
  // A channel already claimed is not offered again: the API upserts on
  // (user, channel), so picking it a second time would silently overwrite the
  // existing claim from a form that says "add".
  const claimed = new Set(rows.map((row) => row.channel_id));
  const available = roster.filter((channel) => !claimed.has(channel.id));

  return (
    <Page>
      <h1 className="text-h1">{copy.memberships.title}</h1>
      <p className="mt-2 max-w-[560px] text-small text-subtle-foreground">
        {copy.memberships.intro}
      </p>

      {memberships.isPending ? (
        <div className="mt-5 flex flex-col gap-2.5">
          <Skeleton className="h-[76px] w-full rounded-2xl" />
          <Skeleton className="h-[76px] w-full rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          className="mt-5"
          variant="card"
          title={copy.memberships.emptyTitle}
          body={copy.memberships.emptyBody}
        />
      ) : (
        <ul className="mt-5 flex flex-col gap-2.5">
          {rows.map((membership) => (
            <li
              key={membership.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
            >
              <ChannelAvatar name={membership.channel_name} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[14.5px] font-semibold text-foreground">
                    {membership.channel_name}
                  </span>
                  {membership.is_verified ? (
                    <ShieldCheck
                      className="size-3.5 shrink-0 text-gold"
                      aria-label={copy.memberships.verified}
                      strokeWidth={2.4}
                    />
                  ) : null}
                </div>
                <p className="mt-0.5 font-mono text-[11.5px] text-subtle-foreground tabular">
                  {/*
                    🚨 A row with no renewal day predates this feature, so there
                    is nothing honest to count from. It asks to be filled in
                    rather than showing a number nobody supplied.
                  */}
                  {membership.months === null
                    ? copy.memberships.needsDetails
                    : copy.memberships.monthsAndRenewal(
                        membership.months,
                        formatDate(membership.next_renewal, copy.common.months),
                      )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="xs"
                shape="pill"
                aria-label={copy.memberships.edit}
                onClick={() => setEditing(membership)}
              >
                <Pencil className="size-4" aria-hidden strokeWidth={2.2} />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                shape="pill"
                aria-label={copy.memberships.remove}
                disabled={remove.isPending}
                onClick={() => remove.mutate(membership)}
              >
                <Trash2 className="size-4" aria-hidden strokeWidth={2.2} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
        Hidden only when every channel is already claimed - with nothing left to
        pick, the form would open onto an empty select.
      */}
      {available.length > 0 ? (
        <Button
          variant="outline"
          size="lg"
          block
          className="mt-4"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" aria-hidden strokeWidth={2.4} />
          {copy.memberships.add}
        </Button>
      ) : null}

      <MembershipEditor
        open={adding}
        onOpenChange={setAdding}
        channels={available}
      />
      <MembershipEditor
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        channels={roster}
        membership={editing}
      />
    </Page>
  );
}
