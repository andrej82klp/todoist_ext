import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { internalServerError } from './api'

const DEV_SECRET = 'dev-secret-encryption-key-change-me'

function getSecretMaterial() {
  const configured = process.env.SESSION_SECRET

  if (configured && configured.length > 0) {
    return configured
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEV_SECRET
  }

  throw internalServerError('SESSION_SECRET is not configured')
}

function getKey() {
  return createHash('sha256').update(getSecretMaterial()).digest()
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv, authTag, ciphertext].map(part => part.toString('base64url')).join('.')
}

export function decryptSecret(serialized: string) {
  const [ivPart, tagPart, payloadPart] = serialized.split('.')

  if (!ivPart || !tagPart || !payloadPart) {
    throw internalServerError('Encrypted secret format is invalid')
  }

  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(payloadPart, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}
