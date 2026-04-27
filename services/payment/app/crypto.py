"""AES-256-GCM encryption for Cardcom tokens stored in DB.

Generate key with:  openssl rand -base64 32
Store in env:       TOKEN_ENCRYPTION_KEY=<base64-output>
"""
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_key() -> bytes:
    key_b64 = os.getenv("TOKEN_ENCRYPTION_KEY", "")
    if not key_b64:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY environment variable is not set")
    key = base64.b64decode(key_b64)
    if len(key) != 32:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes")
    return key


def encrypt_token(plaintext: str) -> str:
    """Encrypt a Cardcom token. Returns base64(nonce + ciphertext)."""
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)          # 96-bit nonce for GCM
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt_token(encrypted_b64: str) -> str:
    """Decrypt a stored Cardcom token."""
    key = _get_key()
    data = base64.b64decode(encrypted_b64)
    nonce, ct = data[:12], data[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")
