import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM. Returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url. `aad` binds the value to its owner. */
export function seal(plain: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url'));
  return [VERSION, ...parts].join('.');
}

/** Throws one generic error on any failure so callers cannot tell which check failed. */
export function open(sealed: string, key: Buffer, aad: string): string {
  try {
    const parts = sealed.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('bad format');
    const [iv, tag, ciphertext] = parts.slice(1).map((p) => Buffer.from(p, 'base64url')) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('bad format');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Cannot open sealed value');
  }
}
