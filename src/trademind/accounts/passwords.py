import hashlib
import hmac
import secrets

_N, _R, _P = 2**14, 8, 1
_SALT_BYTES = 16
_DKLEN = 32


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    algorithm, n, r, p, salt_hex, digest_hex = stored.split("$")
    if algorithm != "scrypt":
        return False
    expected = bytes.fromhex(digest_hex)
    actual = hashlib.scrypt(
        password.encode(),
        salt=bytes.fromhex(salt_hex),
        n=int(n),
        r=int(r),
        p=int(p),
        dklen=len(expected),
    )
    return hmac.compare_digest(actual, expected)
