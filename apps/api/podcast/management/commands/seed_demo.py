"""Seed realistic community data on top of the real ingested episodes.

    python manage.py seed_demo
    python manage.py seed_demo --clear     # remove seeded data, keep episodes

🇧🇬 Content is Bulgarian because the real episodes are. Seeing English lorem ipsum
next to Cyrillic titles hides exactly the layout and tokenization problems this data
is meant to surface.

⚠️ DEV ONLY. Refuses to run with DEBUG=False. It never touches Channel or Episode
rows - those come from the real backfill.
"""

from __future__ import annotations

import random

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from podcast.models import (
    Channel,
    ChannelMembership,
    Comment,
    Episode,
    EpisodeParticipant,
    Favorite,
    Moment,
    Person,
    Rating,
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
    ("demo_stefan", "Стефан", UserProfile.Role.MODERATOR),
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

PEOPLE = [
    ("Иван Кирков", "host"),
    ("Комеди Клуб", "cohost"),
    ("Гост от публиката", "guest"),
]


class Command(BaseCommand):
    help = "Seed demo community data (ratings, comments, topics, moments) onto real episodes."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Remove seeded data and exit")
        parser.add_argument("--seed", type=int, default=42, help="RNG seed for repeatability")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo is DEV ONLY and refuses to run with DEBUG=False")

        if options["clear"]:
            return self._clear()

        episodes = list(Episode.objects.select_related("channel"))
        if not episodes:
            raise CommandError(
                "No episodes found. Run `manage.py backfill_channel @ivankirkov1` first."
            )

        random.seed(options["seed"])
        self.stdout.write(self.style.MIGRATE_HEADING(f"Seeding onto {len(episodes)} episodes"))

        users = self._create_users()
        self._create_memberships(users, episodes[0].channel)
        self._create_people(episodes)
        counts = self._create_engagement(users, episodes)
        self._recompute(episodes)

        self.stdout.write(self.style.SUCCESS("\nSeeded:"))
        for label, value in counts.items():
            self.stdout.write(f"  {label:<12} {value}")
        self.stdout.write(
            "\nSign in as any demo user with:  Authorization: Bearer dev:demo_georgi"
        )

    # -----------------------------------------------------------------------

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

    def _create_memberships(self, users: list[User], channel: Channel) -> None:
        """Verify roughly half, so public and elite scores actually differ."""
        for index, user in enumerate(users):
            verified = index % 2 == 0
            ChannelMembership.objects.update_or_create(
                user=user,
                channel=channel,
                defaults={
                    "tier": "Gold" if verified else "",
                    "is_verified": verified,
                    "verified_at": timezone.now() if verified else None,
                },
            )
        verified_count = sum(1 for i in range(len(users)) if i % 2 == 0)
        self.stdout.write(f"  memberships: {len(users)} ({verified_count} verified)")

    def _create_people(self, episodes: list[Episode]) -> None:
        people = []
        for name, _role in PEOPLE:
            person, _ = Person.objects.get_or_create(
                name=name, defaults={"bio": f"Участник в подкаста. {name}."}
            )
            people.append(person)

        added = 0
        for episode in episodes:
            host, role = people[0], PEOPLE[0][1]
            _, created = EpisodeParticipant.objects.get_or_create(
                episode=episode, person=host, defaults={"role": role}
            )
            added += int(created)
            if random.random() < 0.3:
                guest = random.choice(people[1:])
                _, created = EpisodeParticipant.objects.get_or_create(
                    episode=episode, person=guest, defaults={"role": "guest"}
                )
                added += int(created)
        self.stdout.write(f"  people: {len(people)}, appearances: {added}")

    @transaction.atomic
    def _create_engagement(self, users: list[User], episodes: list[Episode]) -> dict:
        counts = dict(ratings=0, comments=0, topics=0, moments=0, favorites=0, watches=0)

        for episode in episodes:
            # Not every episode gets attention - empty states must be visible too.
            raters = random.sample(users, k=random.randint(0, len(users)))
            for user in raters:
                # Skew high: people rate podcasts they chose to watch.
                score = random.choices(range(1, 11), weights=[1, 1, 2, 3, 5, 8, 12, 18, 16, 10])[0]
                _, created = Rating.objects.get_or_create(
                    user=user, episode=episode, defaults={"score": score}
                )
                counts["ratings"] += int(created)

            for user in random.sample(users, k=random.randint(0, 3)):
                _, created = Comment.objects.get_or_create(
                    user=user,
                    episode=episode,
                    body=random.choice(COMMENTS),
                    defaults={"is_spoiler": random.random() < 0.15},
                )
                counts["comments"] += int(created)

            for name in random.sample(TOPICS, k=random.randint(1, 4)):
                _, created = topic_service.add_topic_to_episode(
                    episode, name, random.choice(users)
                )
                counts["topics"] += int(created)

            if episode.duration_sec:
                for label in random.sample(MOMENT_LABELS, k=random.randint(0, 3)):
                    _, created = Moment.objects.get_or_create(
                        episode=episode,
                        label=label,
                        defaults={
                            "user": random.choice(users),
                            "timestamp_sec": random.randint(60, max(61, episode.duration_sec - 60)),
                        },
                    )
                    counts["moments"] += int(created)

            for user in random.sample(users, k=random.randint(0, 2)):
                _, created = Favorite.objects.get_or_create(user=user, episode=episode)
                counts["favorites"] += int(created)

            for user in random.sample(users, k=random.randint(0, 3)):
                if not WatchEvent.objects.filter(user=user, episode=episode).exists():
                    WatchEvent.objects.create(
                        user=user,
                        episode=episode,
                        watched_on=timezone.localdate()
                        - timezone.timedelta(days=random.randint(0, 400)),
                    )
                    counts["watches"] += 1

        return counts

    def _recompute(self, episodes: list[Episode]) -> None:
        self.stdout.write("  recomputing scores...")
        for episode in episodes:
            scoring.recompute_episode(episode)

    # -----------------------------------------------------------------------

    def _clear(self) -> None:
        users = User.objects.filter(username__startswith=SEED_PREFIX)
        Rating.objects.filter(user__in=users).delete()
        Comment.objects.filter(user__in=users).delete()
        Moment.objects.filter(user__in=users).delete()
        Favorite.objects.filter(user__in=users).delete()
        WatchEvent.objects.filter(user__in=users).delete()
        ChannelMembership.objects.filter(user__in=users).delete()
        EpisodeParticipant.objects.all().delete()
        Person.objects.filter(name__in=[name for name, _ in PEOPLE]).delete()
        Topic.objects.filter(name__in=TOPICS).delete()
        deleted = users.count()
        users.delete()

        for episode in Episode.objects.select_related("channel"):
            scoring.recompute_episode(episode)

        self.stdout.write(
            self.style.SUCCESS(f"Cleared demo data ({deleted} users). Episodes untouched.")
        )
