"use client";

import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, UserRound } from "lucide-react";

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
 * membership, and hiding it turns a ladder into a list of two things you
 * already own.
 *
 * 🔒 The lock is enforced by the API, not here. `PUT /api/me/avatar` re-checks
 * the user's own months and answers 403 - a disabled button is a courtesy, not
 * authorization.
 *
 * ⚠️ THE CATALOGUE IS NEARLY EMPTY ON PURPOSE. The artwork does not exist yet
 * (owner, 2026-08-16: icons keyed to months-per-channel are coming). Everything
 * around it is finished, so the drop is a data change in
 * `apps/api/podcast/data/avatar_icons.py` - no migration, no code here.
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
    return <Skeleton className="mt-1.5 h-20 w-full rounded-xl" />;
  }

  const catalogue = icons.data ?? [];
  // Only the placeholder ships today. Saying so beats an empty box that looks
  // like a failed request.
  const hasArtwork = catalogue.some((icon) => icon.image_url !== "");

  return (
    <div className="mt-1.5">
      {!hasArtwork ? (
        <p className="text-[11.5px] text-subtle-foreground">
          {copy.profile.iconsComingSoon}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {catalogue.map((icon) => (
            <li key={icon.key}>
              <button
                type="button"
                // 🚨 The accessible name carries the cost, not just the label.
                // A screen reader hearing only "BFF Gold" over a greyed tile is
                // told nothing about why it cannot be picked.
                aria-label={
                  icon.unlocked
                    ? icon.label
                    : copy.profile.iconLocked(icon.label, icon.min_months)
                }
                aria-pressed={icon.selected}
                disabled={!icon.unlocked || choose.isPending}
                onClick={() => choose.mutate(icon.selected ? "" : icon.key)}
                className={cn(
                  "relative flex size-14 items-center justify-center overflow-hidden rounded-2xl border bg-card outline-none",
                  icon.selected ? "border-primary" : "border-border-2",
                  !icon.unlocked && "opacity-45",
                )}
              >
                {icon.image_url ? (
                  <Image
                    src={icon.image_url}
                    alt=""
                    width={56}
                    height={56}
                    className="size-full object-cover"
                  />
                ) : (
                  <UserRound
                    className="size-6 text-subtle-foreground"
                    aria-hidden
                    strokeWidth={2}
                  />
                )}
                {!icon.unlocked ? (
                  <span className="absolute right-1 bottom-1 rounded-full bg-background/85 p-0.5">
                    <Lock className="size-3 text-subtle-foreground" aria-hidden />
                  </span>
                ) : null}
                {icon.selected ? (
                  <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5">
                    <Check className="size-3 text-white" aria-hidden strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
