"""User accounts and session tokens; tokens are stored only as SHA-256 hashes."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Column, DateTime, ForeignKey, MetaData, String, Table, delete, insert, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from .passwords import hash_password, verify_password

metadata = MetaData()
users = Table(
    "users",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("email", String(254), nullable=False, unique=True),
    Column("password_hash", String(255), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
sessions = Table(
    "sessions",
    metadata,
    Column("token_hash", String(64), primary_key=True),
    Column(
        "user_id",
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

# Keeps unknown-email logins as slow as wrong-password logins.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


class DuplicateEmailError(Exception):
    pass


@dataclass(frozen=True)
class User:
    id: str
    email: str
    created_at: datetime


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _to_user(row) -> User:
    return User(row["id"], row["email"], _utc(row["created_at"]))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AccountStore:
    def __init__(self, engine: Engine, session_ttl: timedelta = timedelta(hours=12)):
        if engine.dialect.name not in {"postgresql", "sqlite"}:
            raise ValueError("Use PostgreSQL or SQLite for development")
        self.engine = engine
        self.session_ttl = session_ttl

    def create_schema(self) -> None:
        """Explicit development bootstrap; never invoked automatically."""
        metadata.create_all(self.engine)

    def create_user(self, email: str, password: str) -> User:
        user = User(str(uuid.uuid4()), email.strip().lower(), datetime.now(UTC))
        password_hash = hash_password(password)
        try:
            with self.engine.begin() as connection:
                connection.execute(
                    insert(users).values(
                        id=user.id,
                        email=user.email,
                        password_hash=password_hash,
                        created_at=user.created_at,
                    )
                )
        except IntegrityError as error:
            raise DuplicateEmailError(user.email) from error
        return user

    def authenticate(self, email: str, password: str) -> User | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(select(users).where(users.c.email == email.strip().lower()))
                .mappings()
                .first()
            )
        if row is None:
            verify_password(password, _DUMMY_HASH)
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        return _to_user(row)

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self.engine.begin() as connection:
            connection.execute(
                insert(sessions).values(
                    token_hash=_hash_token(token),
                    user_id=user_id,
                    expires_at=datetime.now(UTC) + self.session_ttl,
                )
            )
        return token

    def user_for_token(self, token: str) -> User | None:
        token_hash = _hash_token(token)
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    select(users, sessions.c.expires_at)
                    .select_from(users.join(sessions, sessions.c.user_id == users.c.id))
                    .where(sessions.c.token_hash == token_hash)
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            if _utc(row["expires_at"]) <= datetime.now(UTC):
                connection.execute(delete(sessions).where(sessions.c.token_hash == token_hash))
                return None
        return _to_user(row)

    def delete_session(self, token: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(delete(sessions).where(sessions.c.token_hash == _hash_token(token)))
