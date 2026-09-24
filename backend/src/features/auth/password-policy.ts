// Only entries of 10 or more characters matter: shorter passwords fail the length rule anyway.
const COMMON_PASSWORDS = new Set([
  'password12',
  'password123',
  'password1234',
  'password12345',
  'passw0rd123',
  'passwordpassword',
  '1234567890',
  '0123456789',
  '12345678910',
  '1q2w3e4r5t',
  'qwertyuiop',
  'qwerty1234',
  'qwerty12345',
  'qwerty123456',
  'iloveyou12',
  'iloveyou123',
  'letmein1234',
  'welcome123',
  'welcome1234',
  'admin12345',
  'administrator',
  'changeme123',
  'abc1234567',
  'trustno1234',
  'football123',
  'baseball123',
  'superman123',
  'monkey12345',
  'dragon12345',
  'master12345',
])

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)
}
