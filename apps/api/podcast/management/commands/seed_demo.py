"""Seed realistic community data on top of the real ingested episodes.

    python manage.py seed_demo                          # every channel
    python manage.py seed_demo --channel @ivankirkov1   # just one
    python manage.py seed_demo --clear                  # remove it all, keep episodes

🇧🇬 Content is Bulgarian because the real episodes are. Seeing English lorem ipsum
next to Cyrillic titles hides exactly the layout and tokenization problems this data
is meant to surface.

⚠️ DEV ONLY. Refuses to run with DEBUG=False. It never touches Channel or Episode
rows apart from the denormalized score columns - the episodes come from the real
backfill and are not ours to invent.

🚨 Everything it writes is attributable and therefore removable: every row hangs off
a user whose username starts with `demo_`, plus the topics and people listed below.
`--clear` is the exact inverse of a run.
"""

from __future__ import annotations

import random

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from podcast.models import (
    Channel,
    ChannelMembership,
    Comment,
    Episode,
    EpisodeParticipant,
    EpisodeTopic,
    EpisodeTopicVote,
    Favorite,
    Moment,
    Person,
    PersonalTag,
    Rating,
    Report,
    Topic,
    UserProfile,
    WatchEvent,
)
from podcast.services import scoring
from podcast.services import topics as topic_service

SEED_PREFIX = "demo_"

DEMO_USERS = [
    ("demo_georgi", "Георги", UserProfile.Role.MEMBER),
    ("demo_maria", "Мария", UserProfile.Role.MEMBER),
    ("demo_petar", "Петър", UserProfile.Role.MEMBER),
    ("demo_elena", "Елена", UserProfile.Role.MEMBER),
    ("demo_nikolay", "Николай", UserProfile.Role.MEMBER),
    ("demo_ivana", "Ивана", UserProfile.Role.MEMBER),
    ("demo_dimitar", "Димитър", UserProfile.Role.MEMBER),
    ("demo_yana", "Яна", UserProfile.Role.MEMBER),
    ("demo_kaloyan", "Калоян", UserProfile.Role.MEMBER),
    ("demo_desislava", "Десислава", UserProfile.Role.MEMBER),
    ("demo_borislav", "Борислав", UserProfile.Role.MEMBER),
    ("demo_tsvetina", "Цветина", UserProfile.Role.MEMBER),
    ("demo_stefan", "Стефан", UserProfile.Role.MODERATOR),
    ("demo_admin", "Админ", UserProfile.Role.ADMIN),
]

TOPICS = [
    "Политика", "Спорт", "Музика", "Кино", "Технологии", "Пътувания",
    "Храна", "История", "Психология", "Бизнес", "Здраве", "Образование",
    "Хумор", "Култура", "Наука",
]

COMMENTS = [
    "Един от най-добрите епизоди досега.",
    "Смях се на глас в метрото.",
    "Гостът беше страхотен, дано дойде пак.",
    "Втората половина е много по-силна от първата.",
    "Слушам го за трети път и още е забавно.",
    "Темата ме изненада приятно.",
    "Малко дълъг, но си заслужава.",
    "Точно това ми трябваше днес.",
    "Страхотна дискусия, много се смях.",
    "Не очаквах такъв обрат в разговора.",
    "Първите двайсет минути са бавни, после тръгва.",
    "Върнах се да го чуя пак заради последната част.",
]

# 🔒 PRIVATE per-user notes. Deliberately phrased as things someone writes for
# THEMSELVES ("to rewatch", "for the podcast list") rather than as public topic
# labels. If these read like topics, a leak of private data onto a public
# endpoint would look like correct output in a screenshot.
PERSONAL_TAG_TEXTS = [
    "да гледам пак",
    "за цитиране",
    "препоръчано от Мария",
    "недовършен",
    "за списъка с любими",
    "чака втора част",
    "показах го на брат ми",
    "най-смешният досега",
    "за бавна вечер",
    "проверка на факти",
]

REPORT_REASONS = [
    "Спам съдържание",
    "Обиден език",
    "Грешен таймкод",
    "Етикетът няма връзка с епизода",
    "Разкрива развръзката без предупреждение",
    "Дублиран коментар",
    "Подвеждащо описание",
]

RESOLUTION_NOTES = [
    "Скрито от модератор.",
    "Проверено, няма нарушение.",
    "Етикетът е коригиран.",
    "Потвърдено и премахнато.",
]

MOMENT_LABELS = [
    "Смешната история за колата",
    "Спорът за най-добрия филм",
    "Разказва за първата си работа",
    "Обяснява защо е сгрешил",
    "Неочакван обрат в разговора",
    "Спомен от детството",
    "Съветът към младите",
    "Историята с кучето",
    "Дебатът за парите",
    "Най-смешният момент",
]

# The host is per channel; guests are a shared pool. Naming the host after the
# channel matters - one hardcoded host across every channel is the kind of seed
# data that makes a real cross-channel bug look intentional.
CHANNEL_HOSTS = {
    "@ivankirkov1": "Иван Кирков",
    "@comedyclubpodcast": "Комеди Клуб",
}

GUESTS = [
    "Мартин Христов",
    "Радост Петрова",
    "Александър Тонев",
    "Симона Илиева",
    "Веселин Драганов",
]

"""Personas an EARLIER version of this seeder invented and no longer creates.

🚨 `--clear` matches people by name, so a name dropped from `GUESTS` becomes
undeletable rather than harmless: the rows it already wrote stay behind forever.
`Гост от публиката` did exactly that - it survived the 2026-08-10
`seed_demo --clear`, and five days later it was still showing up as a real
participant filter on /episodes with 12 participations.

Never delete from this set. Retiring a persona means MOVING its name here.
"""
LEGACY_DEMO_PEOPLE_NAMES = {
    "Гост от публиката",
}

DEMO_PEOPLE_NAMES = set(GUESTS) | set(CHANNEL_HOSTS.values()) | LEGACY_DEMO_PEOPLE_NAMES


class Command(BaseCommand):
    help = "Seed demo community data (ratings, comments, topics, moments) onto real episodes."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Remove seeded data and exit")
        parser.add_argument("--seed", type=int, default=42, help="RNG seed for repeatability")
        parser.add_argument(
            "--channel",
            default=None,
            help="Limit to one channel by handle, slug or YouTube id. Default: every channel.",
        )
        parser.add_argument(
            "--coverage",
            type=float,
            default=0.85,
            help=(
                "Fraction of episodes that get any engagement (default 0.85). "
                "The remainder stay genuinely untouched so the unrated states are visible."
            ),
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo is DEV ONLY and refuses to run with DEBUG=False")

        if options["clear"]:
            return self._clear()

        coverage = options["coverage"]
        if not 0 < coverage <= 1:
            raise CommandError("--coverage must be between 0 (exclusive) and 1")

        channels = self._resolve_channels(options["channel"])
        # 🚨 `order_by("id")` is what makes `--seed` mean anything. Without it
        # Postgres may hand back the rows in a different physical order on each
        # run, so the same RNG sequence lands on DIFFERENT episodes - and a
        # second run, instead of being a no-op, writes a fresh set of rows on
        # top of the first. Measured: re-running doubled every table
        # (201 -> 342 ratings) while reporting a normal-looking summary.
        episodes = list(
            Episode.objects.filter(channel__in=channels)
            .select_related("channel")
            .order_by("id")
        )
        if not episodes:
            raise CommandError(
                "No episodes found. Run `manage.py backfill_channel @ivankirkov1` first."
            )

        random.seed(options["seed"])
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"Seeding {len(episodes)} episodes across {len(channels)} channel(s)"
            )
        )

        users = self._create_users()
        self._create_memberships(users, channels)
        self._create_participants(episodes, users)
        counts = self._create_engagement(users, episodes, coverage)
        self._create_topics(episodes, users, coverage)
        counts["tags"] = self._create_personal_tags(users, episodes, coverage)
        # Reports run LAST: they point at the comments, moments, topic links and
        # ratings the steps above just created, so an earlier call would find
        # empty pools and silently seed nothing.
        counts["reports"] = self._create_reports(users, episodes)

        self.stdout.write("  recomputing scores...")
        # reindex=False: this queues nothing. A bulk load followed by one
        # `manage.py reindex` beats a thousand single-document tasks.
        scoring.recompute_many([e.pk for e in episodes], reindex=False)

        self.stdout.write(self.style.SUCCESS("\nSeeded:"))
        for label, value in counts.items():
            self.stdout.write(f"  {label:<12} {value}")
        self.stdout.write(
            "\nSign in as any demo user with:  Authorization: Bearer dev:demo_georgi"
        )
        self.stdout.write(
            self.style.WARNING("Run `manage.py reindex` to refresh Meilisearch.")
        )

    # -----------------------------------------------------------------------

    def _resolve_channels(self, selector: str | None) -> list[Channel]:
        if not selector:
            channels = list(Channel.objects.all())
            if not channels:
                raise CommandError("No channels ingested yet.")
            return channels

        handle = selector if selector.startswith("@") else f"@{selector}"
        channel = (
            Channel.objects.filter(handle=handle).first()
            or Channel.objects.filter(slug=selector).first()
            or Channel.objects.filter(youtube_channel_id=selector).first()
        )
        if not channel:
            known = ", ".join(Channel.objects.values_list("handle", flat=True))
            raise CommandError(f"No channel matches {selector!r}. Known: {known}")
        return [channel]

    def _create_users(self) -> list[User]:
        users = []
        for username, display, role in DEMO_USERS:
            user, _ = User.objects.get_or_create(
                username=username, defaults={"email": f"{username}@dev.local"}
            )
            UserProfile.objects.update_or_create(
                user=user,
                defaults={
                    "clerk_user_id": f"dev_{username}",
                    "display_name": display,
                    "role": role,
                },
            )
            users.append(user)
        self.stdout.write(f"  users: {len(users)}")
        return users

    def _create_memberships(self, users: list[User], channels: list[Channel]) -> None:
        """Memberships on EVERY channel, so elite scores exist everywhere.

        🚨 Verification is deliberately not the same set of users per channel. If
        the same people were verified everywhere, an elite score that accidentally
        ignored the channel join would still look right.
        """
        verified_total = 0
        for offset, channel in enumerate(channels):
            for index, user in enumerate(users):
                verified = (index + offset) % 3 != 0
                ChannelMembership.objects.update_or_create(
                    user=user,
                    channel=channel,
                    defaults={
                        "tier": "Gold" if verified else "",
                        "is_verified": verified,
                        "verified_at": timezone.now() if verified else None,
                    },
                )
                verified_total += int(verified)
        self.stdout.write(
            f"  memberships: {len(users) * len(channels)} ({verified_total} verified)"
        )

    def _create_participants(self, episodes: list[Episode], users: list[User]) -> None:
        hosts: dict[int, Person] = {}
        for channel in {episode.channel for episode in episodes}:
            name = CHANNEL_HOSTS.get(channel.handle, channel.name)
            person, _ = Person.objects.get_or_create(
                name=name, defaults={"bio": f"Водещ на {channel.name}."}
            )
            hosts[channel.id] = person

        guests = [
            Person.objects.get_or_create(name=name, defaults={"bio": "Гост в подкаста."})[0]
            for name in GUESTS
        ]

        existing = set(
            EpisodeParticipant.objects.filter(
                episode__in=[e.pk for e in episodes]
            ).values_list("episode_id", "person_id")
        )

        rows = []
        for episode in episodes:
            host = hosts[episode.channel_id]
            if (episode.pk, host.pk) not in existing:
                rows.append(
                    EpisodeParticipant(
                        episode=episode, person=host, role="regular", added_by=users[0]
                    )
                )
            if random.random() < 0.35:
                guest = random.choice(guests)
                # 🚨 Drawn BEFORE the existence check, never inside it. See the
                # note on `_create_engagement` - a draw that only happens for
                # new rows makes the second run diverge from the first.
                added_by = random.choice(users)
                if (episode.pk, guest.pk) not in existing:
                    rows.append(
                        EpisodeParticipant(
                            episode=episode,
                            person=guest,
                            role="guest",
                            added_by=added_by,
                        )
                    )

        EpisodeParticipant.objects.bulk_create(rows, batch_size=1000, ignore_conflicts=True)
        self.stdout.write(
            f"  people: {len(hosts) + len(guests)}, appearances: +{len(rows)}"
        )

    @transaction.atomic
    def _create_engagement(
        self, users: list[User], episodes: list[Episode], coverage: float
    ) -> dict:
        """Ratings, comments, moments, favorites and watch events.

        🚨 RNG DISCIPLINE, and it is not optional anywhere in this command:
        **every `random.*` call happens BEFORE the "does this row already exist"
        check, never inside it.**

        A draw that only runs for NEW rows makes the random stream diverge the
        moment anything already exists. The seed then stops meaning what
        `--seed` advertises, and a second run - instead of being a no-op - lands
        on a different set of (user, episode) pairs and writes a whole new
        generation of rows on top of the first. Measured 2026-08-11: re-running
        doubled every table (201 -> 342 ratings, 72 -> 142 reports) while
        printing a perfectly normal-looking summary.

        So the draws below look wasteful on a repeat run. That waste IS the
        determinism.
        """
        episode_ids = [e.pk for e in episodes]

        # Pre-load what already exists so a second run adds nothing. Rating and
        # Favorite have DB uniqueness; Comment, Moment and WatchEvent do NOT (a
        # genuine second viewing on the same day is legal data), so for those the
        # idempotency has to be here.
        rated = set(
            Rating.objects.filter(episode_id__in=episode_ids).values_list(
                "user_id", "episode_id"
            )
        )
        favorited = set(
            Favorite.objects.filter(episode_id__in=episode_ids).values_list(
                "user_id", "episode_id"
            )
        )
        watched = set(
            WatchEvent.objects.filter(episode_id__in=episode_ids).values_list(
                "user_id", "episode_id"
            )
        )
        commented = set(
            Comment.objects.filter(episode_id__in=episode_ids).values_list(
                "user_id", "episode_id"
            )
        )
        momented = set(
            Moment.objects.filter(episode_id__in=episode_ids).values_list(
                "episode_id", "label"
            )
        )

        ratings, comments, moments, favorites, watches = [], [], [], [], []
        today = timezone.localdate()

        for episode in episodes:
            if random.random() > coverage:
                continue  # a genuinely untouched episode

            # Skew high: people rate podcasts they chose to watch.
            for user in random.sample(users, k=random.randint(0, len(users))):
                score = random.choices(
                    range(1, 11), weights=[1, 1, 2, 3, 5, 8, 12, 18, 16, 10]
                )[0]
                if (user.pk, episode.pk) in rated:
                    continue
                ratings.append(Rating(user=user, episode=episode, score=score))

            for user in random.sample(users, k=random.randint(0, 3)):
                body = random.choice(COMMENTS)
                is_spoiler = random.random() < 0.15
                if (user.pk, episode.pk) in commented:
                    continue
                comments.append(
                    Comment(
                        user=user,
                        episode=episode,
                        body=body,
                        is_spoiler=is_spoiler,
                    )
                )

            if episode.duration_sec:
                for label in random.sample(MOMENT_LABELS, k=random.randint(0, 3)):
                    author = random.choice(users)
                    at = random.randint(60, max(61, episode.duration_sec - 60))
                    if (episode.pk, label) in momented:
                        continue
                    moments.append(
                        Moment(
                            episode=episode,
                            user=author,
                            label=label,
                            timestamp_sec=at,
                        )
                    )

            for user in random.sample(users, k=random.randint(0, 2)):
                if (user.pk, episode.pk) in favorited:
                    continue
                favorites.append(Favorite(user=user, episode=episode))

            for user in random.sample(users, k=random.randint(0, 3)):
                days_ago = random.randint(0, 400)
                if (user.pk, episode.pk) in watched:
                    continue
                watches.append(
                    WatchEvent(
                        user=user,
                        episode=episode,
                        watched_on=today - timezone.timedelta(days=days_ago),
                    )
                )

        for model, rows in (
            (Rating, ratings),
            (Comment, comments),
            (Moment, moments),
            (Favorite, favorites),
            (WatchEvent, watches),
        ):
            model.objects.bulk_create(rows, batch_size=1000, ignore_conflicts=True)

        return {
            "ratings": len(ratings),
            "comments": len(comments),
            "moments": len(moments),
            "favorites": len(favorites),
            "watches": len(watches),
        }

    def _create_topics(
        self, episodes: list[Episode], users: list[User], coverage: float
    ) -> None:
        """Attach 1-4 canonical topics per episode, with votes.

        Names still go through `resolve_topic`, which is the canonical entry
        point, but the per-episode attachment is bulked rather than looped
        through `add_topic_to_episode` - 5,000 sequential service calls to
        produce rows this command already knows the shape of.
        """
        topics = [topic_service.resolve_topic(name) for name in TOPICS]
        episode_ids = [e.pk for e in episodes]

        existing = set(
            EpisodeTopic.objects.filter(episode_id__in=episode_ids).values_list(
                "episode_id", "topic_id"
            )
        )

        # 🚨 `candidates` holds EVERY (episode, topic) the RNG picked, including
        # ones that already exist. The votes loop below iterates over this list,
        # so filtering it here would shorten that loop on a second run and shift
        # the random stream for everything after it - which is precisely how the
        # seeder stopped being reproducible. The existence check belongs at the
        # INSERT, not in the list the RNG walks.
        candidates: list[tuple[Episode, Topic, User]] = []
        for episode in episodes:
            if random.random() > coverage:
                continue
            for topic in random.sample(topics, k=random.randint(1, 4)):
                # Drawn for every candidate, not only the new ones.
                added_by = random.choice(users)
                candidates.append((episode, topic, added_by))

        EpisodeTopic.objects.bulk_create(
            [
                EpisodeTopic(episode=episode, topic=topic, added_by=added_by)
                for episode, topic, added_by in candidates
                if (episode.pk, topic.pk) not in existing
            ],
            batch_size=1000,
            ignore_conflicts=True,
        )

        # ignore_conflicts means bulk_create hands back no primary keys on
        # Postgres, so the ids come from a re-read rather than from the insert.
        links = {
            (row["episode_id"], row["topic_id"]): row["id"]
            for row in EpisodeTopic.objects.filter(
                episode_id__in=episode_ids
            ).values("id", "episode_id", "topic_id")
        }
        voted = set(
            EpisodeTopicVote.objects.filter(
                episode_topic_id__in=list(links.values())
            ).values_list("episode_topic_id", "user_id")
        )

        votes = []
        for episode, topic, _added_by in candidates:
            link_id = links.get((episode.pk, topic.pk))
            if link_id is None:
                continue
            for user in random.sample(users, k=random.randint(1, 5)):
                # A minority downvote is what makes the sort order mean
                # anything; all-positive scores sort as insertion order.
                value = 1 if random.random() < 0.85 else -1
                if (link_id, user.pk) in voted:
                    continue
                votes.append(
                    EpisodeTopicVote(
                        episode_topic_id=link_id,
                        user=user,
                        value=value,
                    )
                )

        EpisodeTopicVote.objects.bulk_create(
            votes, batch_size=1000, ignore_conflicts=True
        )
        self._recompute_topic_scores(episode_ids)
        fresh = sum(
            1 for e, t, _ in candidates if (e.pk, t.pk) not in existing
        )
        self.stdout.write(f"  topics: +{fresh} links, +{len(votes)} votes")

    def _create_personal_tags(
        self, users: list[User], episodes: list[Episode], coverage: float
    ) -> int:
        """🔒 PRIVATE per-user keywords, on a MINORITY of episodes.

        Deliberately sparser than any public signal (~18% of covered episodes).
        Personal tags are a power-user feature; seeding them at the same density
        as ratings would make a privacy leak on a public endpoint look normal -
        a tag on every episode is indistinguishable from a topic chip at a
        glance, which is exactly the confusion this data should NOT create.
        """
        episode_ids = [e.pk for e in episodes]
        existing = set(
            PersonalTag.objects.filter(episode_id__in=episode_ids).values_list(
                "user_id", "episode_id", "text"
            )
        )

        rows = []
        for episode in episodes:
            if random.random() > coverage * 0.18:
                continue
            for user in random.sample(users, k=random.randint(1, 2)):
                for text in random.sample(
                    PERSONAL_TAG_TEXTS, k=random.randint(1, 3)
                ):
                    if (user.pk, episode.pk, text) in existing:
                        continue
                    rows.append(
                        PersonalTag(user=user, episode=episode, text=text)
                    )

        PersonalTag.objects.bulk_create(rows, batch_size=1000, ignore_conflicts=True)
        self.stdout.write(f"  personal tags: +{len(rows)} (private)")
        return len(rows)

    def _create_reports(self, users: list[User], episodes: list[Episode]) -> int:
        """Fill the moderation queue across ALL FOUR reportable types and all
        three statuses.

        🚨 The queue must not be seeded pending-only. A queue containing nothing
        but `pending` never exercises the resolved/dismissed filters, and the
        `status=all` branch of `list_reports` would render identically to the
        default - a broken filter would look correct.
        """
        episode_ids = [e.pk for e in episodes]
        moderators = [
            u
            for u in users
            if u.profile.role in {UserProfile.Role.MODERATOR, UserProfile.Role.ADMIN}
        ]

        # Only the four types `REPORTABLE` in the moderation router accepts. A
        # report pointing at anything else is not reachable through the API and
        # would be seed data that no code path can produce.
        # `order_by("id")` on every pool: an unordered LIMIT is not a stable
        # slice, so the same seed would sample different targets each run.
        def pool(model, cap):
            return list(
                model.objects.filter(episode_id__in=episode_ids)
                .order_by("id")
                .values_list("id", flat=True)[:cap]
            )

        pools = {
            Comment: pool(Comment, 400),
            Moment: pool(Moment, 200),
            EpisodeTopic: pool(EpisodeTopic, 400),
            Rating: pool(Rating, 400),
        }

        existing = set(
            Report.objects.values_list("reporter_id", "content_type_id", "object_id")
        )

        now = timezone.now()
        rows = []
        for model, ids in pools.items():
            if not ids:
                continue
            content_type = ContentType.objects.get_for_model(model)
            for target_id in random.sample(ids, k=min(len(ids), 18)):
                # Every draw happens unconditionally, before the skip. See
                # `_create_engagement`.
                reporter = random.choice(users)
                status = random.choices(
                    [
                        Report.Status.PENDING,
                        Report.Status.RESOLVED,
                        Report.Status.DISMISSED,
                    ],
                    weights=[5, 3, 2],
                )[0]
                reason = random.choice(REPORT_REASONS)
                resolver = random.choice(moderators)
                note = random.choice(RESOLUTION_NOTES)

                if (reporter.pk, content_type.pk, target_id) in existing:
                    continue

                handled = status != Report.Status.PENDING
                rows.append(
                    Report(
                        reporter=reporter,
                        reason=reason,
                        content_type=content_type,
                        object_id=target_id,
                        status=status,
                        resolved_by=resolver if handled else None,
                        resolved_at=now if handled else None,
                        resolution_note=note if handled else "",
                    )
                )

        Report.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)
        pending = sum(1 for r in rows if r.status == Report.Status.PENDING)
        self.stdout.write(f"  reports: +{len(rows)} ({pending} pending)")
        return len(rows)

    def _recompute_topic_scores(self, episode_ids: list[int]) -> None:
        """Set-based equivalent of `topic_service.recompute_topic_score`."""
        totals = {
            row["id"]: row["total"] or 0
            for row in EpisodeTopic.objects.filter(episode_id__in=episode_ids)
            .annotate(total=Sum("votes__value"))
            .values("id", "total")
        }
        pending = [EpisodeTopic(id=pk, score=score) for pk, score in totals.items()]
        EpisodeTopic.objects.bulk_update(pending, ["score"], batch_size=1000)

    # -----------------------------------------------------------------------

    def _clear(self) -> None:
        users = User.objects.filter(username__startswith=SEED_PREFIX)
        user_ids = list(users.values_list("id", flat=True))

        # 🚨 Reports go FIRST and EXPLICITLY. `Report.reporter` is SET_NULL and
        # the target is a GenericForeignKey, so neither deleting the demo users
        # nor deleting the reported comments removes a Report row. Left to the
        # cascade, `--clear` would strand every report as an ownerless row
        # pointing at a primary key that no longer exists - and the moderation
        # queue renders it fine, because `_report_out` never dereferences the
        # target. The leak would be invisible until the ids got reused.
        Report.objects.filter(reporter_id__in=user_ids).delete()
        PersonalTag.objects.filter(user_id__in=user_ids).delete()
        Rating.objects.filter(user_id__in=user_ids).delete()
        Comment.objects.filter(user_id__in=user_ids).delete()
        Moment.objects.filter(user_id__in=user_ids).delete()
        Favorite.objects.filter(user_id__in=user_ids).delete()
        WatchEvent.objects.filter(user_id__in=user_ids).delete()
        ChannelMembership.objects.filter(user_id__in=user_ids).delete()

        # Scoped to the people this command invents. `EpisodeParticipant.objects
        # .all().delete()` would take real participants with it.
        demo_people = Person.objects.filter(name__in=DEMO_PEOPLE_NAMES)
        channel_hosts = Person.objects.filter(
            name__in=Channel.objects.values_list("name", flat=True)
        )
        people_ids = list(demo_people.values_list("id", flat=True)) + list(
            channel_hosts.values_list("id", flat=True)
        )
        EpisodeParticipant.objects.filter(person_id__in=people_ids).delete()
        Person.objects.filter(id__in=people_ids).delete()

        Topic.objects.filter(name__in=TOPICS).delete()  # cascades EpisodeTopic + votes

        deleted = users.count()
        users.delete()

        scoring.recompute_many(reindex=False)

        self.stdout.write(
            self.style.SUCCESS(f"Cleared demo data ({deleted} users). Episodes untouched.")
        )
        self.stdout.write(
            self.style.WARNING("Run `manage.py reindex` to refresh Meilisearch.")
        )
