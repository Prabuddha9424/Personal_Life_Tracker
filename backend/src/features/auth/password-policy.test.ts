import { describe, expect, it } from 'vitest'
import { isCommonPassword } from './password-policy.ts'

describe('isCommonPassword', () => {
  it.each(['password1234', 'Password123', 'QWERTYUIOP', '1234567890', 'aaaaaaaaaaaa'])(
    'flags %s',
    (password) => {
      expect(isCommonPassword(password)).toBe(true)
    },
  )

  it.each(['correct-horse-battery', 'T7#kd92!Lp0x', 'my dog is called Rex 42'])(
    'accepts %s',
    (password) => {
      expect(isCommonPassword(password)).toBe(false)
    },
  )
})
