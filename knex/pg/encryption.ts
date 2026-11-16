import { assert } from "jsr:@std/assert";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { cacheHandler, stringKey } from "../../cache.ts";
import { configString } from "../../config.ts";
import { isProductionModeEnabled, isTestModeEnabled } from "../../service.ts";
import type { Encrypted } from "./types.ts";

export const ENCRYPTED_PREFIX = "enc:";

const ALGORITHM = "aes-256-gcm";
const MESSAGE_ID_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// part of every derived key, changing it makes existing values unreadable
const HKDF_INFO = "pg-encryption";

// all-zero key for tests and docker compose, terraform's modules/postgres and
// modules/postgres-shared set the real one
const DEVELOPMENT_KEYS = `dev:${encodeBase64(new Uint8Array(KEY_LENGTH))}`;

type Key = {
  id: string;
  key: Uint8Array;
};

/**
 * Parses `<id>:<base64>,<id>:<base64>` into keys, the first key is active
 */
export function parseKeys(value: string): Key[] {
  const keys = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part): Key => {
      const [id, key, ...rest] = part.split(":");
      assert(
        id && key && rest.length === 0,
        "encryption key format <id>:<base64>",
      );
      const bytes = decodeBase64(key);
      assert(
        bytes.length === KEY_LENGTH,
        `encryption key ${id} is not 32 bytes`,
      );
      return { id, key: bytes };
    });
  assert(keys.length > 0, "no encryption keys");
  assert(
    new Set(keys.map(({ id }) => id)).size === keys.length,
    "duplicate encryption key id",
  );
  return keys;
}

const overrides = new Map<string, Key[]>();

/**
 * Replaces the keys of a connection for the rest of the process, lets a test
 * simulate a key rotation without restarting
 */
export function overrideEncryptionKeys(name: string, value: string) {
  assert(isTestModeEnabled, "encryption keys can only be overridden in tests");
  overrides.set(name, parseKeys(value));
}

const getKeys = cacheHandler(
  stringKey,
  (_, name: string) => {
    const value = configString(`${name}_postgres_encryption_keys`);
    // the development key is public, it must never encrypt production data
    assert(
      value || !isProductionModeEnabled,
      `${name}_postgres_encryption_keys is not set`,
    );
    return parseKeys(value || DEVELOPMENT_KEYS);
  },
);

/**
 * Checks whether a stored value is in the encrypted format
 */
export function isEncryptedValue(value: string): value is Encrypted {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Returns the key id a stored value was encrypted with, null for plaintext
 */
export function encryptedKeyId(value: string): string | null {
  if (!isEncryptedValue(value)) {
    return null;
  }
  const [, id] = value.split(":");
  return id ?? null;
}

/**
 * Derives the AES key of a single value from the master key and the value's random
 * message id (HKDF-SHA256). Every value gets its own key, so random IVs never repeat
 * under a key, no matter how many values are written (AES-GCM's 2^32 limit per key).
 */
function deriveKey(masterKey: Uint8Array, messageId: Uint8Array) {
  return new Uint8Array(
    hkdfSync("sha256", masterKey, messageId, HKDF_INFO, KEY_LENGTH),
  );
}

/**
 * Creates encrypt/decrypt helpers bound to the keys of a database connection.
 * Values are stored as `enc:<keyId>:<base64(messageId | iv | tag | ciphertext)>`.
 * Decrypt passes plaintext through so rows that are not migrated yet keep working.
 * Values are deliberately not bound to their row or column (no AAD).
 */
export function createEncryption(name: string) {
  function keys() {
    return overrides.get(name) ?? getKeys(name);
  }

  function activeKeyId() {
    return keys()[0].id;
  }

  function encrypt(plain: string): Encrypted {
    const [active] = keys();
    const messageId = randomBytes(MESSAGE_ID_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(
      ALGORITHM,
      deriveKey(active.key, messageId),
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(plain, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = encodeBase64(
      Buffer.concat([messageId, iv, tag, encrypted]),
    );
    return `${ENCRYPTED_PREFIX}${active.id}:${payload}` as Encrypted;
  }

  function decrypt(value: Encrypted | string): string {
    if (!isEncryptedValue(value)) {
      return value;
    }
    const [, id, payload, ...rest] = value.split(":");
    assert(id && payload && rest.length === 0, "malformed encrypted value");
    const key = keys().find((key) => key.id === id);
    assert(key, `unknown encryption key ${id}`);
    const bytes = decodeBase64(payload);
    assert(
      bytes.length >= MESSAGE_ID_LENGTH + IV_LENGTH + TAG_LENGTH,
      "malformed encrypted value",
    );
    const messageId = bytes.subarray(0, MESSAGE_ID_LENGTH);
    const iv = bytes.subarray(MESSAGE_ID_LENGTH, MESSAGE_ID_LENGTH + IV_LENGTH);
    const tag = bytes.subarray(
      MESSAGE_ID_LENGTH + IV_LENGTH,
      MESSAGE_ID_LENGTH + IV_LENGTH + TAG_LENGTH,
    );
    const encrypted = bytes.subarray(
      MESSAGE_ID_LENGTH + IV_LENGTH + TAG_LENGTH,
    );
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveKey(key.key, messageId),
      iv,
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
      .toString("utf8");
  }

  return { encrypt, decrypt, activeKeyId };
}
