import re
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

from trademind.accounts import AccountStore, DuplicateEmailError, User

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class SignUpRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        value = value.strip()
        if not _EMAIL.fullmatch(value):
            raise ValueError("Enter a valid email address")
        return value


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class UserOut(BaseModel):
    id: str
    email: str
    created_at: datetime

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        return cls(id=user.id, email=user.email, created_at=user.created_at)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


def create_app(
    store: AccountStore,
    app: FastAPI | None = None,
) -> FastAPI:
    if app is None:
        app = FastAPI(title="TradeMind API", version="0.1.0")

    bearer = HTTPBearer(auto_error=False)

    def current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> User:
        user = store.user_for_token(credentials.credentials) if credentials else None
        if user is None:
            raise HTTPException(
                status_code=401,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/auth/signup", status_code=201, response_model=UserOut)
    def sign_up(body: SignUpRequest) -> UserOut:
        try:
            user = store.create_user(body.email, body.password)
        except DuplicateEmailError as error:
            raise HTTPException(status_code=409, detail="Email already registered") from error
        return UserOut.from_user(user)

    @app.post("/auth/login", response_model=TokenOut)
    def log_in(body: LoginRequest) -> TokenOut:
        user = store.authenticate(body.email, body.password)
        if user is None:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        return TokenOut(access_token=store.create_session(user.id))

    @app.post("/auth/logout", status_code=204)
    def log_out(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> Response:
        if credentials:
            store.delete_session(credentials.credentials)
        return Response(status_code=204)

    @app.get("/auth/me", response_model=UserOut)
    def me(user: User = Depends(current_user)) -> UserOut:
        return UserOut.from_user(user)

    return app
