# Task 03: Phase 1 Authentication System — JWT, Password Hashing & RBAC

> **Status**: Ready for Implementation
> **Estimated Time**: 2-3 days
> **Depends On**: [Task 02 — 数据库层](02-phase-1-database.md)
> **Required By**: [Task 04 — 股票数据](04-phase-1-stock-data.md)
> **参考设计文档**:
> - [001-preliminary-design.md](../design/001-preliminary-design.md) — 总体架构
> - [phase-1.md](../design/phase-1.md) — Phase 1 MVP 详细设计
> - [003-api-specification.md](../design/003-api-specification.md) — API规格

---

## 1. Objective

Implement JWT-based authentication with dual-token system (access + refresh), bcrypt password hashing, role-based access control (admin/user), global exception handlers, and user profile endpoints.

---

## 2. Files to Create

### 2.1 `backend/app/core/security.py`

JWT token creation/verification and password hashing.

```python
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(subject: int, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a short-lived JWT access token.
    Default expiry: settings.ACCESS_TOKEN_EXPIRE_MINUTES (30 min).
    """
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    return jwt.encode(
        {
            "sub": str(subject),
            "iat": int(now.timestamp()),
            "exp": int(expire.timestamp()),
            "type": "access",
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_refresh_token(subject: int, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a long-lived JWT refresh token.
    Default expiry: settings.REFRESH_TOKEN_EXPIRE_DAYS (30 days).
    """
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))
    return jwt.encode(
        {
            "sub": str(subject),
            "iat": int(now.timestamp()),
            "exp": int(expire.timestamp()),
            "type": "refresh",
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def verify_token(token: str) -> Optional[dict[str, Any]]:
    """Decode and verify a JWT token. Returns payload dict or None if invalid."""
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None


def get_user_id_from_token(token: str) -> Optional[int]:
    """Extract the user ID (int) from a valid token, or None."""
    payload = verify_token(token)
    if payload is None:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError, TypeError):
        return None
```

### 2.2 `backend/app/core/exceptions.py`

Global exception handlers registered on the FastAPI app.

```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppException(Exception):
    """Base application exception with status code and error code."""
    def __init__(self, detail: str, status_code: int = 400, code: str = "APP_ERROR"):
        self.detail = detail
        self.status_code = status_code
        self.code = code


def register_exception_handlers(app: FastAPI) -> None:

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": f"HTTP_{exc.status_code}"},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = [
            {
                "field": ".".join(str(l) for l in e["loc"]),
                "message": e["msg"],
                "type": e["type"],
            }
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={"detail": "Validation error", "code": "VALIDATION_ERROR", "errors": errors},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "code": "INTERNAL_ERROR"},
        )
```

### 2.3 `backend/app/core/deps.py`

Extend the existing file from Task 02 with auth dependencies.

```python
from typing import AsyncGenerator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings
from app.core.security import get_user_id_from_token
from app.models.user import User

# ============================================================
# Database (from Task 02)
# ============================================================

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    pool_size=20,
    max_overflow=10,
    pool_recycle=3600,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ============================================================
# Authentication Dependencies
# ============================================================

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate Bearer token, return the authenticated User. Raises 401/403."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    user_id = get_user_id_from_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    return user


async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Ensure the current user has admin role. Raises 403 otherwise."""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
```

### 2.4 `backend/app/api/v1/router.py`

Update to register auth and users routers.

```python
from fastapi import APIRouter
from app.api.v1 import auth, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
```

### 2.5 `backend/app/api/v1/auth.py`

Register, login, and token refresh endpoints.

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr, Field

from app.core.deps import get_db, get_current_user
from app.core.config import settings
from app.core.security import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, get_user_id_from_token,
)
from app.models.user import User, UserSession

router = APIRouter()


# --- Request Schemas (inline — resolves in same file) ---

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    nickname: str | None = Field(None, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: int
    email: str
    nickname: str | None
    avatar_url: str | None
    role: str
    status: str
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# --- Endpoints ---

@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        nickname=body.nickname,
        role="user",
        status="active",
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account is inactive")

    user.last_login_at = datetime.now(timezone.utc)

    access_token = create_access_token(subject=user.id)
    refresh_token = create_refresh_token(subject=user.id)

    session = UserSession(
        user_id=user.id,
        refresh_token=refresh_token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.flush()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    user_id = get_user_id_from_token(body.refresh_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.refresh_token == body.refresh_token,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=401, detail="Refresh token not found")
    if session.expires_at < datetime.now(timezone.utc):
        await db.delete(session)
        raise HTTPException(status_code=401, detail="Refresh token expired")

    new_access = create_access_token(subject=user_id)
    new_refresh = create_refresh_token(subject=user_id)

    session.refresh_token = new_refresh
    session.expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    return TokenResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
```

### 2.6 `backend/app/api/v1/users.py`

Get and update own profile.

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.api.v1.auth import UserOut

router = APIRouter()


class UserUpdate(BaseModel):
    nickname: str | None = Field(None, max_length=100)
    avatar_url: str | None = Field(None, max_length=500)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
async def update_me(body: UserUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.nickname is not None:
        current_user.nickname = body.nickname
    if body.avatar_url is not None:
        current_user.avatar_url = body.avatar_url
    await db.flush()
    await db.refresh(current_user)
    return current_user
```

### 2.7 Update `backend/app/main.py`

Add exception handler registration.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init scheduler, Redis pool, etc. (future tasks)
    yield
    # Shutdown: cleanup connections (future tasks)


app = FastAPI(
    title="Trend-Scope API",
    description="Phase 1 MVP — Trend analysis platform",
    version="0.1.0",
    lifespan=lifespan,
)

register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
```

---

## 3. API Endpoint Specification

### 3.1 `POST /api/v1/auth/register`

**Request**:
```json
{"email": "user@example.com", "password": "mypass123", "nickname": "Alice"}
```

**Response 201** — `UserOut`:
```json
{
  "id": 2, "email": "user@example.com", "nickname": "Alice",
  "avatar_url": null, "role": "user", "status": "active",
  "last_login_at": null, "created_at": "2026-06-09T...", "updated_at": "2026-06-09T..."
}
```

**Errors**: 409 (duplicate email), 422 (validation)

### 3.2 `POST /api/v1/auth/login`

**Request**:
```json
{"email": "admin@trend-scope.com", "password": "Admin123!"}
```

**Response 200** — `TokenResponse`:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 1800
}
```

**Errors**: 401 (bad credentials), 403 (inactive account)

### 3.3 `POST /api/v1/auth/refresh`

**Request**:
```json
{"refresh_token": "eyJ..."}
```

**Response 200** — `TokenResponse` (new token pair, old refresh token rotated)

**Errors**: 401 (invalid/expired refresh token)

### 3.4 `GET /api/v1/users/me`

**Headers**: `Authorization: Bearer <access_token>`

**Response 200** — `UserOut`

### 3.5 `PATCH /api/v1/users/me`

**Headers**: `Authorization: Bearer <access_token>`

**Request**:
```json
{"nickname": "New Name"}
```

**Response 200** — updated `UserOut`

---

## 4. Test Specifications

### 4.1 `backend/tests/test_security.py`

```python
import pytest
from app.core.security import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, verify_token, get_user_id_from_token,
)

def test_hash_and_verify():
    pw = "testpass"
    h = hash_password(pw)
    assert h != pw
    assert verify_password(pw, h)
    assert not verify_password("wrong", h)

def test_bcrypt_unique_salts():
    pw = "same"
    assert hash_password(pw) != hash_password(pw)

def test_access_token_roundtrip():
    token = create_access_token(subject=42)
    payload = verify_token(token)
    assert payload is not None
    assert payload["sub"] == "42"
    assert payload["type"] == "access"

def test_get_user_id():
    token = create_access_token(subject=99)
    assert get_user_id_from_token(token) == 99

def test_invalid_token():
    assert verify_token("bad.token.xxx") is None
    assert get_user_id_from_token("bad.token.xxx") is None

def test_refresh_token_type():
    token = create_refresh_token(subject=1)
    payload = verify_token(token)
    assert payload["type"] == "refresh"
```

### 4.2 `backend/tests/test_auth_api.py`

Uses `httpx.AsyncClient` with `ASGITransport` to test the full auth flow against the actual FastAPI app.

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models import User

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest.mark.asyncio
async def test_register_and_login(client: AsyncClient):
    email = f"test_{pytest.tmp}@example.com"

    # Register
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "test123456", "nickname": "Tester"
    })
    assert r.status_code == 201
    data = r.json()
    assert data["email"] == email
    assert data["role"] == "user"
    assert data["status"] == "active"

    # Login
    r = await client.post("/api/v1/auth/login", json={
        "email": email, "password": "test123456"
    })
    assert r.status_code == 200
    tokens = r.json()
    assert "access_token" in tokens
    assert "refresh_token" in tokens
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 1800

    # Access protected route
    r = await client.get("/api/v1/users/me", headers={
        "Authorization": f"Bearer {tokens['access_token']}"
    })
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == email
    assert me["nickname"] == "Tester"

@pytest.mark.asyncio
async def test_register_duplicate(client: AsyncClient):
    email = f"dup_{pytest.tmp}@example.com"
    await client.post("/api/v1/auth/register", json={"email": email, "password": "test123456"})
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "test123456"})
    assert r.status_code == 409

@pytest.mark.asyncio
async def test_login_bad_credentials(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={
        "email": "admin@trend-scope.com", "password": "wrong"
    })
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_login_nonexistent(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={
        "email": "nobody@nowhere.com", "password": "anything"
    })
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_refresh_token_flow(client: AsyncClient):
    # Login as seed admin
    r = await client.post("/api/v1/auth/login", json={
        "email": "admin@trend-scope.com", "password": "Admin123!"
    })
    tokens = r.json()

    # Refresh
    r = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": tokens["refresh_token"]
    })
    assert r.status_code == 200
    new_tokens = r.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]  # token rotation

    # Old refresh token should now be invalid
    r = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": tokens["refresh_token"]
    })
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_refresh_with_bad_token(client: AsyncClient):
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": "garbage"})
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_unauthenticated_access(client: AsyncClient):
    r = await client.get("/api/v1/users/me")
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_update_profile(client: AsyncClient):
    r = await client.post("/api/v1/auth/login", json={
        "email": "admin@trend-scope.com", "password": "Admin123!"
    })
    token = r.json()["access_token"]

    r = await client.patch("/api/v1/users/me",
        json={"nickname": "SuperAdmin"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["nickname"] == "SuperAdmin"

@pytest.mark.asyncio
async def test_admin_role_check(client: AsyncClient):
    # Register a regular user
    email = f"regular_{pytest.tmp}@example.com"
    await client.post("/api/v1/auth/register", json={
        "email": email, "password": "test123456"
    })
    r = await client.post("/api/v1/auth/login", json={
        "email": email, "password": "test123456"
    })
    token = r.json()["access_token"]

    # get_current_user should succeed (returns user info)
    r = await client.get("/api/v1/users/me", headers={
        "Authorization": f"Bearer {token}"
    })
    assert r.status_code == 200
    assert r.json()["role"] == "user"
```

---

## 5. Acceptance Criteria

- [ ] `backend/app/core/security.py` provides `hash_password`, `verify_password`, `create_access_token`, `create_refresh_token`, `verify_token`, `get_user_id_from_token`
- [ ] Access tokens contain `sub`, `iat`, `exp`, `type=access` — expire in 30 min
- [ ] Refresh tokens contain `sub`, `iat`, `exp`, `type=refresh` — expire in 30 days
- [ ] BCrypt hashing with unique salt per password
- [ ] `backend/app/core/exceptions.py` defines `AppException` and 4 global handlers (AppException, StarletteHTTPException, RequestValidationError, unhandled Exception)
- [ ] Exception handlers registered in `main.py`
- [ ] `backend/app/core/deps.py` provides `get_current_user` (raises 401 on missing/invalid token, 403 on inactive) and `get_admin_user` (raises 403 for non-admin)
- [ ] `POST /auth/register` — creates user with hashed password, returns 201 UserOut; 409 on duplicate email; validates email format and password ≥6 chars
- [ ] `POST /auth/login` — returns access + refresh tokens, updates `last_login_at`; 401 on bad credentials; 403 on inactive
- [ ] `POST /auth/refresh` — issues new token pair with rotation (old refresh token invalidated); 401 on expired/invalid
- [ ] `GET /users/me` — returns current user profile (auth required)
- [ ] `PATCH /users/me` — updates nickname and/or avatar_url (auth required)
- [ ] All tests in `test_security.py` and `test_auth_api.py` pass
- [ ] Swagger at `/docs` shows all 5 endpoints with schemas

---

## 6. Estimated Time Breakdown

| Subtask | Est. Time |
|---|---|
| `security.py` — JWT + password hashing | 1.5h |
| `exceptions.py` — AppException + handlers | 1h |
| `deps.py` — auth dependencies | 1h |
| `auth.py` — 3 endpoints (register, login, refresh) | 2h |
| `users.py` — 2 endpoints (get me, update me) | 0.5h |
| `router.py` + `main.py` updates | 0.5h |
| Tests — test_security.py | 0.75h |
| Tests — test_auth_api.py | 2h |
| Docker verification | 1h |
| **Total** | **~10.25h (1.5-2 days)** |
