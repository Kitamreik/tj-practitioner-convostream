/**
 * Webmaster password vault — client-side AES-GCM encryption.
 *
 * The previous design wrote plaintext passwords to `managedPasswords/{uid}`.
 * Even though Firestore rules limited that collection to webmasters, a
 * single bad role grant or misconfigured rule would leak every operator
 * password in the workspace.
 *
 * The new design:
 *  - Webmaster picks a vault passphrase the first time they open the
 *    vault. We derive an AES-GCM-256 key from it via PBKDF2-SHA256
 *    (200_000 iterations) using a per-doc salt.
 *  - The plaintext password is encrypted in-browser BEFORE it ever
 *    touches Firestore.
 *  - The Firestore document only stores `{ ciphertext, iv, salt, algo,
 *    iterations }` — no plaintext, no key.
 *  - The derived key lives in module memory only (cleared on lock /
 *    sign-out). It is NEVER persisted to localStorage, sessionStorage,
 *    or IndexedDB.
 *  - A workspace-wide `appSettings/vaultCheck` doc holds an encrypted
 *    sentinel string used to verify the passphrase on subsequent
 *    unlocks. A wrong passphrase fails decryption (AES-GCM auth tag).
 *
 * This means a Firestore exfiltration alone can no longer recover the
 * plaintext passwords — an attacker would also need the webmaster's
 * vault passphrase, which is never written down.
 */

const VAULT_ALGO = "AES-GCM-256/PBKDF2-SHA256";
const VAULT_ITERATIONS = 200_000;
const SENTINEL = "convohub-vault-v1-ok";

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string;         // base64
  salt: string;       // base64
  algo: string;
  iterations: number;
}

let cachedPassphrase: string | null = null;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase) as unknown as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, VAULT_ITERATIONS);
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return {
    ciphertext: toB64(ct),
    iv: toB64(iv),
    salt: toB64(salt),
    algo: VAULT_ALGO,
    iterations: VAULT_ITERATIONS,
  };
}

export async function decryptWithPassphrase(blob: EncryptedBlob, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromB64(blob.salt), blob.iterations || VAULT_ITERATIONS);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ciphertext)
  );
  return new TextDecoder().decode(pt);
}

/** Build the encrypted sentinel doc used to verify the passphrase. */
export async function buildSentinel(passphrase: string): Promise<EncryptedBlob> {
  return encryptWithPassphrase(SENTINEL, passphrase);
}

/** Returns true when decryption succeeds AND yields the known sentinel. */
export async function verifySentinel(blob: EncryptedBlob, passphrase: string): Promise<boolean> {
  try {
    const out = await decryptWithPassphrase(blob, passphrase);
    return out === SENTINEL;
  } catch {
    return false;
  }
}

/** Cache the verified passphrase in memory for this tab. */
export function cachePassphrase(passphrase: string): void {
  cachedPassphrase = passphrase;
}

export function getCachedPassphrase(): string | null {
  return cachedPassphrase;
}

export function clearVault(): void {
  cachedPassphrase = null;
}

export function isVaultUnlocked(): boolean {
  return cachedPassphrase !== null;
}
