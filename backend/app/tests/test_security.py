from app.core.security import create_access_token, create_refresh_token, get_user_id_from_token, hash_password, verify_password, verify_token


def test_hash_and_verify_password():
    password = "testpass123"
    hashed = hash_password(password)
    assert hashed != password
    assert verify_password(password, hashed)
    assert not verify_password("wrong", hashed)


def test_bcrypt_uses_unique_salts():
    assert hash_password("same-password") != hash_password("same-password")


def test_access_token_roundtrip():
    token = create_access_token(subject=42)
    payload = verify_token(token)
    assert payload is not None
    assert payload["sub"] == "42"
    assert payload["type"] == "access"
    assert get_user_id_from_token(token, expected_type="access") == 42


def test_refresh_token_roundtrip():
    token = create_refresh_token(subject=7)
    payload = verify_token(token)
    assert payload is not None
    assert payload["sub"] == "7"
    assert payload["type"] == "refresh"
    assert get_user_id_from_token(token, expected_type="refresh") == 7
    assert get_user_id_from_token(token, expected_type="access") is None


def test_invalid_token():
    assert verify_token("bad.token") is None
    assert get_user_id_from_token("bad.token") is None
