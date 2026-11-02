"""Salted Argon2id credentials; passwords are never stored in plaintext."""

from threading import BoundedSemaphore

from argon2 import PasswordHasher, extract_parameters
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type

# OWASP's Argon2id minimum; explicit settings keep memory bounded under load.
HASHER = PasswordHasher(
    time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID
)
MAX_PASSWORD_LENGTH = 128
# Bound memory-hard hashing across the HTTP request thread pool.
_HASH_SLOTS = BoundedSemaphore(4)


def validate_password(password: str) -> None:
    if not isinstance(password, str) or not 15 <= len(password) <= MAX_PASSWORD_LENGTH:
        raise ValueError("Use a password with 15 to 128 characters.")
    if password in {"invoice-checker", "password1234", "changeme12345"}:
        raise ValueError("Choose a non-default password.")


def hash_password(password: str) -> str:
    validate_password(password)
    with _HASH_SLOTS:
        return HASHER.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    if not isinstance(password, str) or not 1 <= len(password) <= MAX_PASSWORD_LENGTH:
        return False
    try:
        params = extract_parameters(encoded)
        if (
            params.type,
            params.version,
            params.time_cost,
            params.memory_cost,
            params.parallelism,
            params.hash_len,
            params.salt_len,
        ) != (Type.ID, 19, 2, 19456, 1, 32, 16):
            return False
        with _HASH_SLOTS:
            return HASHER.verify(encoded, password)
    except (InvalidHashError, VerificationError, ValueError, TypeError):
        return False
