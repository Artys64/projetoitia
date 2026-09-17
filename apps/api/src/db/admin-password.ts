import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export function normalizeAdminUsername(value: string): string {
  return value.trim().toLowerCase()
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashAdminPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) throw new Error('A senha deve ter entre 12 e 256 caracteres')
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`
}

// Unknown accounts also perform the password derivation to avoid a fast lookup failure.
const dummyHash = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`

export async function verifyAdminPassword(password: string, storedHash?: string): Promise<boolean> {
  const [algorithm, salt, expected] = (storedHash ?? dummyHash).split('$')
  if (algorithm !== 'scrypt' || !salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false
  const actual = await derive(password, salt)
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && storedHash !== undefined
}
