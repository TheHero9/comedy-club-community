"use client";

import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { notify } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import type { AvatarIcon, Me } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Choosing a profile icon, with the locked ones still on show.
 *
 * 🚨 LOCKED ICONS ARE VISIBLE, greyed and captioned with what they cost. That
 * is the entire feature: an icon you cannot have yet is the reason to keep a
 * membership, and hiding it turns a ladder into a list of the two things you
 * already own.
 *
 * 🔒 The lock is enforced by the API, not here. `PUT /api/me/avatar` re-checks
 * the user's own months and answers 403 - a disabled button is a courtesy, not
 * authorization.
 *
 * 🇧🇬 The visible label is composed HERE from `min_months`, not taken from the
 * API's `label`. Tier names ("new member", "1 year") are UI chrome and must
 * follow the locale; the channel NAME beside them is content and is rendered
 * exactly as the API returns it, untranslated.
 */
export function AvatarPicker() {
  const copy = useCopy();
  const queryClient = useQueryClient();

  const icons = useQuery({
    queryKey: ["me", "avatars"],
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<AvatarIcon[]>("/api/me/avatars", {
        signal,
        cache: "no-store",
      }),
  });

  const choose = useMutation({
    mutationFn: (key: string) =>
      viewerApi.put<Me>("/api/me/avatar", { avatar_key: key }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["me", "avatars"] }),
      ]);
      notify.success(copy.profile.savedToast);
    },
    onError: () => notify.error(copy.errors.generic),
  });

  if (icons.isPending) {
    return <Skeleton className="mt-1.5 h-24 w-full rounded-xl" />;
  }

  const catalogue = icons.data ?? [];
  if (catalogue.length === 0) {
    // Saying so beats an empty box that looks like a failed request.
    return (
      <p className="mt-1.5 text-[11.5px] text-subtle-foreground">
        {copy.profile.iconsComingSoon}
      </p>
    );
  }

  /**
   * Grouped by channel, in catalogue order.
   *
   * 🚨 Order is the API's, never re-sorted. The catalogue lists each channel's
   * ladder cheapest-rung-first on purpose, and sorting here by anything else
   * (unlocked first, say) would scramble the one thing the grid is meant to
   * communicate: how far along the ladder you are.
   */
  const groups: { name: string | null; icons: AvatarIcon[] }[] = [];
  for (const icon of catalogue) {
    const name = icon.channel_name ?? null;
    const last = groups.at(-1);
    if (last && last.name === name) last.icons.push(icon);
    else groups.push({ name, icons: [icon] });
  }

  return (
    <div className="mt-1.5 flex flex-col gap-3">
      {groups.map((group, index) => (
        <div key={group.name ?? `free-${index}`}>
          <p className="text-[11px] font-semibold text-subtle-foreground">
            {group.name ?? copy.profile.iconEveryone}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {group.icons.map((icon) => {
              const tier = copy.profile.iconTier(icon.min_months);
              return (
                <li key={icon.key}>
                  <button
                    type="button"
                    /* 🚨 The accessible name carries the COST, not just the
                       tier. A screen reader hearing "1 year" over a greyed tile
                       is told nothing about why it cannot be picked. */
                    aria-label={
                      icon.unlocked
                        ? tier
                        : copy.profile.iconLocked(tier, icon.min_months)
                    }
                    title={icon.unlocked ? tier : copy.profile.iconLocked(tier, icon.min_months)}
                    aria-pressed={icon.selected}
                    disabled={!icon.unlocked || choose.isPending}
                    /* Clicking the selected icon clears it, so there is a way
                       back to the default without a second control. */
                    onClick={() => choose.mutate(icon.selected ? "" : icon.key)}
                    className={cn(
                      "relative flex size-12 items-center justify-center overflow-hidden rounded-2xl border bg-card outline-none",
                      icon.selected ? "border-primary" : "border-border-2",
                      !icon.unlocked && "opacity-40 grayscale",
                    )}
                  >
                    <Image
                      src={icon.image_url}
                      alt=""
                      width={48}
                      height={48}
                      className="size-full object-cover"
                      // Twenty small PNGs in a sheet the user opened on
                      // purpose: no reason to defer any of them.
                      unoptimized
                    />
                    {!icon.unlocked ? (
                      <span className="absolute right-0.5 bottom-0.5 rounded-full bg-background/85 p-0.5">
                        <Lock className="size-2.5 text-subtle-foreground" aria-hidden />
                      </span>
                    ) : null}
                    {icon.selected ? (
                      <span className="absolute top-0.5 right-0.5 rounded-full bg-primary p-0.5">
                        <Check
                          className="size-2.5 text-primary-foreground"
                          aria-hidden
                          strokeWidth={3}
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
