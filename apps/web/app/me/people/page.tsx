"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { ProposalQueue } from "@/components/manage/ProposalQueue";
import { ReportQueue } from "@/components/manage/ReportQueue";
import { SignedOutNotice } from "@/components/profile/SignedOutNotice";
import { EmptyState } from "@/components/shared/EmptyState";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Page, PageHeading } from "@/components/shell/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/client";
import type { AdminUser, Me, Person } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";

/**
 * One page of personas.
 *
 * 🚨 The list used to be unbounded, and the owner named the ceiling before it
 * arrived: "the people section will have multiple people there, so we should
 * optimise it - you have 1000, I can't render 1000 people." It is also the
 * source list for every "approve as" dropdown in the review queue, so an
 * unbounded fetch here would be paid for once per queue row.
 */
const PEOPLE_PAGE = 50;

/**
 * Curating personas and reviewing suggestions, without Django Admin.
 *
 * 🚨 WHY THIS PAGE EXISTS AT ALL. `Person` is the canonical list, and a
 * member's typed name must never become one - the Bulgarian auto-captions
 * mishear Тонката as Донката, and the same performer is also Тони, so free
 * text would split one filmography across three near-empty pages. Someone with
 * permission has to make that call, and doing it in Django Admin meant leaving
 * the product to run the product. This is that job, in the app.
 *
 * 🔒 The role check here only decides what to RENDER. Every endpoint behind it
 * re-checks on the server, because a hidden button is not a permission.
 */
export default function ManagePeoplePage() {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const { signedIn } = useViewerAuth();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => viewerApi.get<Me>("/api/me", { cache: "no-store" }),
    enabled: signedIn,
  });

  const isStaff = me.data?.role === "admin" || me.data?.role === "moderator";

  const [term, setTerm] = useState("");
  // How many pages have been asked for. A count rather than a cursor because
  // the API pages by offset, and re-fetching from 0 on every "load more" keeps
  // one query key holding one visible list - no client-side page stitching,
  // and an approval that renames a persona cannot leave a stale earlier page
  // on screen.
  const [pages, setPages] = useState(1);

  const people = useQuery({
    queryKey: ["manage", "people", term, pages],
    queryFn: () =>
      viewerApi.get<Person[]>("/api/people", {
        query: { limit: PEOPLE_PAGE * pages, ...(term.trim() ? { q: term.trim() } : {}) },
        cache: "no-store",
      }),
    enabled: Boolean(isStaff),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["manage"] });
  };

  // A short page means the server had nothing more to give. No total is needed
  // for that, which is why the endpoint still returns a plain array.
  const hasMore = (people.data ?? []).length >= PEOPLE_PAGE * pages;

  if (!signedIn) return <SignedOutNotice />;

  if (me.isLoading) {
    return (
      <Page>
        <Skeleton className="h-8 w-40" />
      </Page>
    );
  }

  if (!isStaff) {
    return (
      <Page>
        <PageHeading title={copy.manage.title} />
        <p className="mt-3 text-small text-subtle-foreground">{copy.manage.adminOnly}</p>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeading title={copy.manage.title} />
      <p className="mt-2 max-w-[62ch] text-small text-subtle-foreground">
        {copy.manage.intro}
      </p>

      <PersonForm onDone={refresh} />

      <input
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          // Back to one page on a new search - otherwise a term typed after
          // three "load more" clicks silently asks for 150 matches.
          setPages(1);
        }}
        placeholder={copy.manage.peopleSearch}
        className="mt-4 w-full max-w-[320px] rounded-pill border border-border bg-background px-3 py-2 text-small"
      />

      {people.isLoading ? (
        <Skeleton className="mt-5 h-24 w-full" />
      ) : (people.data ?? []).length === 0 ? (
        term.trim() ? (
          <p className="mt-3 text-small text-subtle-foreground">
            {copy.manage.peopleNoMatch}
          </p>
        ) : (
          <EmptyState className="mt-5" title={copy.manage.title} body={copy.manage.peopleEmpty} />
        )
      ) : (
        <>
          <ul className="mt-5 flex flex-col gap-2">
            {(people.data ?? []).map((person) => (
              <PersonRow
                key={person.slug}
                person={person}
                canDelete={me.data?.role === "admin"}
                onDone={refresh}
              />
            ))}
          </ul>
          {hasMore ? (
            <button
              type="button"
              onClick={() => setPages((current) => current + 1)}
              className="mt-3 rounded-pill border border-border px-3 py-1.5 text-[12.5px] text-subtle-foreground outline-none"
            >
              {copy.manage.peopleMore}
            </button>
          ) : null}
        </>
      )}

      <ProposalQueue />

      <ReportQueue />

      {/* 🔒 Admins only, and the API agrees. A moderator who could grant roles
          would promote themselves, which makes the two roles one role. */}
      {me.data?.role === "admin" ? <RolesPanel /> : null}
    </Page>
  );
}

function RolesPanel() {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");

  const users = useQuery({
    queryKey: ["manage", "users", term],
    queryFn: () =>
      viewerApi.get<AdminUser[]>("/api/moderation/users", {
        query: term.trim() ? { q: term.trim() } : {},
        cache: "no-store",
      }),
  });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) =>
      viewerApi.patch<AdminUser>(`/api/moderation/users/${id}`, { role }),
    onSuccess: () => {
      notify.success(copy.manage.roleChanged);
      queryClient.invalidateQueries({ queryKey: ["manage", "users"] });
    },
    onError: (caught) => {
      // 409 is the self-lockout guard. Naming it explains WHY the select
      // snapped back, instead of looking like a failed save.
      notify.error(
        isApiError(caught) && caught.status === 409
          ? copy.manage.roleSelfBlocked
          : copy.errors.generic,
      );
    },
  });

  const ROLES = ["member", "moderator", "admin"] as const;
  const roleLabel = (key: string) =>
    ({
      member: copy.manage.roleMember,
      moderator: copy.manage.roleModerator,
      admin: copy.manage.roleAdmin,
    })[key] ?? copy.manage.roleMember;

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-semibold">{copy.manage.rolesTitle}</h2>
      <p className="mt-1 max-w-[62ch] text-small text-subtle-foreground">
        {copy.manage.rolesIntro}
      </p>

      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={copy.manage.rolesSearch}
        className="mt-3 w-full max-w-[320px] rounded-pill border border-border bg-background px-3 py-2 text-small"
      />

      {users.isLoading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : (users.data ?? []).length === 0 ? (
        <p className="mt-2 text-small text-subtle-foreground">{copy.manage.rolesEmpty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {(users.data ?? []).map((user) => (
            <li
              key={user.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-small font-semibold">
                  {user.display_name || user.username}
                  {user.is_me ? (
                    <span className="ml-1.5 text-[11px] font-normal text-subtle-foreground">
                      ({copy.manage.roleYou})
                    </span>
                  ) : null}
                </span>
                {user.handle ? (
                  <span className="block text-[11.5px] text-subtle-foreground">
                    {user.handle}
                  </span>
                ) : null}
              </span>

              <select
                value={user.role}
                // Your own row is not editable - see roleSelfBlocked. Disabling
                // it here means the guard is visible, not just enforced.
                disabled={user.is_me || setRole.isPending}
                onChange={(event) =>
                  setRole.mutate({ id: user.id, role: event.target.value })
                }
                className="rounded-pill border border-border bg-background px-3 py-1.5 text-small disabled:opacity-50"
              >
                {ROLES.map((key) => (
                  <option key={key} value={key}>
                    {roleLabel(key)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonForm({
  person,
  onDone,
}: {
  person?: Person;
  onDone: () => void;
}) {
  const copy = useCopy();
  const editing = Boolean(person);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(person?.name ?? "");
  const [bio, setBio] = useState(person?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(person?.avatar_url ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), bio: bio.trim(), avatar_url: avatarUrl.trim() };
      return editing
        ? viewerApi.patch<Person>(`/api/moderation/people/${person!.slug}`, body)
        : viewerApi.post<Person>("/api/moderation/people", body);
    },
    onSuccess: () => {
      notify.success(editing ? copy.manage.saved : copy.manage.added);
      setName(editing ? name : "");
      setBio(editing ? bio : "");
      setAvatarUrl(editing ? avatarUrl : "");
      setOpen(false);
      setError(null);
      onDone();
    },
    onError: (caught) => {
      // 409 is the duplicate-slug guard, which is the one error worth naming:
      // it is the feature working, not a failure.
      if (isApiError(caught) && caught.status === 409) {
        setError(copy.manage.duplicate);
      } else {
        setError(isApiError(caught) ? caught.userMessage : copy.errors.generic);
      }
    },
  });

  if (!open) {
    return editing ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.manage.edit}
        className="rounded-pill p-1.5 text-subtle-foreground outline-none hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    ) : (
      <Button variant="outline" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {copy.manage.addTitle}
      </Button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!name.trim()) {
          setError(copy.manage.namePlaceholder);
          return;
        }
        save.mutate();
      }}
      className="mt-4 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[170px] flex-1 flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">{copy.manage.nameLabel}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={copy.manage.namePlaceholder}
            maxLength={200}
            autoFocus
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          />
        </label>
        <label className="flex min-w-[190px] flex-[2] flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">{copy.manage.bioLabel}</span>
          <input
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder={copy.manage.bioPlaceholder}
            maxLength={2000}
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          />
        </label>
        <label className="flex min-w-[170px] flex-1 flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">
            {copy.manage.avatarLabel}
          </span>
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder={copy.manage.avatarPlaceholder}
            maxLength={200}
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {editing ? copy.manage.save : copy.manage.add}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            {copy.manage.cancel}
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-primary-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function PersonRow({
  person,
  canDelete,
  onDone,
}: {
  person: Person;
  canDelete: boolean;
  onDone: () => void;
}) {
  const copy = useCopy();

  const remove = useMutation({
    mutationFn: () => viewerApi.delete(`/api/moderation/people/${person.slug}`),
    onSuccess: () => {
      notify.success(copy.manage.removed);
      onDone();
    },
    onError: () => notify.error(copy.errors.generic),
  });

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="w-9 shrink-0">
        <PersonAvatar name={person.name} slug={person.slug} size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-small font-semibold">{person.name}</span>
        <span className="block text-[11.5px] text-subtle-foreground">
          {copy.manage.appearances(person.appearance_count ?? 0)}
          {person.bio ? ` · ${person.bio}` : ""}
        </span>
      </span>
      <PersonForm person={person} onDone={onDone} />
      {/* 🔒 Deleting is admin-only and cascades to every appearance, so it is
          confirmed by name rather than by a bare icon click. */}
      {canDelete ? (
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(copy.manage.removeConfirm(person.name))) remove.mutate();
          }}
          aria-label={copy.manage.remove}
          className="rounded-pill p-1.5 text-subtle-foreground outline-none hover:text-primary-text"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}
