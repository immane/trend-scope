from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client


@pytest.mark.asyncio
async def test_register_login_me_and_update_profile(client: AsyncClient):
    email = f"user-{uuid4().hex}@example.com"
    register_response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "test123456", "nickname": "Tester"},
    )
    assert register_response.status_code == 201
    assert register_response.json()["email"] == email

    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "test123456"},
    )
    assert login_response.status_code == 200
    tokens = login_response.json()
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 1800

    me_response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == email

    update_response = await client.patch(
        "/api/v1/users/me",
        json={"nickname": "Updated"},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["nickname"] == "Updated"


@pytest.mark.asyncio
async def test_duplicate_register_returns_409(client: AsyncClient):
    email = f"dup-{uuid4().hex}@example.com"
    payload = {"email": email, "password": "test123456"}
    assert (await client.post("/api/v1/auth/register", json=payload)).status_code == 201
    assert (await client.post("/api/v1/auth/register", json=payload)).status_code == 409


@pytest.mark.asyncio
async def test_bad_login_and_unauthenticated_me(client: AsyncClient):
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "wrong"},
    )
    assert login_response.status_code == 401
    assert (await client.get("/api/v1/users/me")).status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_rotation(client: AsyncClient):
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@trend-scope.com", "password": "Admin123!"},
    )
    assert login_response.status_code == 200
    tokens = login_response.json()

    refresh_response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refresh_response.status_code == 200
    new_tokens = refresh_response.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]

    old_refresh_response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert old_refresh_response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_rejects_access_token(client: AsyncClient):
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@trend-scope.com", "password": "Admin123!"},
    )
    tokens = login_response.json()
    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["access_token"]},
    )
    assert response.status_code == 401
