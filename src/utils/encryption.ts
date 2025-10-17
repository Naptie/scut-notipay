import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { CipherGCM, DecipherGCM } from 'crypto';

/**
 * Simple encryption utility for storing sensitive data
 * Uses AES-256-GCM encryption
 */
export class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32;
  private ivLength = 16;
  private saltLength = 64;
  private tagLength = 16;

  /**
   * Derive an encryption key from a master password
   */
  private deriveKey(masterPassword: string, salt: Buffer): Buffer {
    return scryptSync(masterPassword, salt, this.keyLength);
  }

  /**
   * Encrypt data using a master password
   */
  encrypt(data: string, masterPassword: string): string {
    const salt = randomBytes(this.saltLength);
    const key = this.deriveKey(masterPassword, salt);
    const iv = randomBytes(this.ivLength);

    const cipher = createCipheriv(this.algorithm, key, iv) as CipherGCM;
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine salt + iv + authTag + encrypted data
    const combined = Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, 'hex')]);
    return combined.toString('base64');
  }

  /**
   * Decrypt data using a master password
   */
  decrypt(encryptedData: string, masterPassword: string): string {
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract components
    const salt = combined.subarray(0, this.saltLength);
    const iv = combined.subarray(this.saltLength, this.saltLength + this.ivLength);
    const authTag = combined.subarray(
      this.saltLength + this.ivLength,
      this.saltLength + this.ivLength + this.tagLength
    );
    const encrypted = combined.subarray(this.saltLength + this.ivLength + this.tagLength);

    const key = this.deriveKey(masterPassword, salt);

    const decipher = createDecipheriv(this.algorithm, key, iv) as DecipherGCM;
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

export const encryptionService = new EncryptionService();
