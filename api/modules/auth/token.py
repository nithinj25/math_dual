import os
import time
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient, PyJWTError


class InvalidToken(Exception):
    """Any token that fails verification, for any reason."""


@dataclass(frozen=True)
class ProviderIdentity:
    subject: str        # Supabase's 'sub' — NOT users.id
    email: str | None


AUTH_MODE = os.environ.get("AUTH_MODE", "real")
ISSUER    = os.environ.get("SUPABASE_JWT_ISSUER")
AUDIENCE  = os.environ.get("SUPABASE_JWT_AUD", "authenticated")
JWKS_URL  = os.environ.get("SUPABASE_JWKS_URL")

FAKE_ISSUER = "fake-issuer"
FAKE_SECRET = os.environ.get("FAKE_AUTH_SECRET", "fake-secret-local-dev-only")

_jwks: PyJWKClient | None = None
if AUTH_MODE == "real":
    if not (ISSUER and JWKS_URL):
        raise RuntimeError("AUTH_MODE=real needs SUPABASE_JWT_ISSUER and SUPABASE_JWKS_URL")
    _jwks = PyJWKClient(JWKS_URL, cache_jwk_set=True, lifespan=300)
elif os.environ.get("ENVIRONMENT") == "production":
    raise RuntimeError("AUTH_MODE=fake must never run in production")


def verify_token(token: str) -> ProviderIdentity:
    """Verify a token and return the provider's identity claims."""
    try:
        if AUTH_MODE == "fake":
            key, algs, issuer = FAKE_SECRET, ["HS256"], FAKE_ISSUER
        else:
            key = _jwks.get_signing_key_from_jwt(token).key
            algs, issuer = ["RS256", "ES256"], ISSUER

        claims = jwt.decode(
            token, key,
            algorithms=algs,
            audience=AUDIENCE,
            issuer=issuer,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except PyJWTError as e:
        raise InvalidToken(str(e)) from e

    return ProviderIdentity(subject=claims["sub"], email=claims.get("email"))


def make_fake_token(subject: str, email: str = "test@example.com",
                    expires_in: int = 900) -> str:
    """Test only. Pass expires_in <= 0 to mint an already-expired token."""
    now = int(time.time())
    return jwt.encode(
        {"sub": subject, "email": email, "iss": FAKE_ISSUER, "aud": AUDIENCE,
         "iat": now, "exp": now + expires_in},
        FAKE_SECRET, algorithm="HS256",
    )
