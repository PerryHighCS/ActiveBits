const ID_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789'
const BYTE_RANGE = 256
const ACCEPTANCE_BOUND = Math.floor(BYTE_RANGE / ID_ALPHABET.length) * ID_ALPHABET.length

export function generateShortId(length = 6): string {
  if (length <= 0) {
    return ''
  }

  let out = ''

  while (out.length < length) {
    const chunk = new Uint8Array((length - out.length) * 2)
    crypto.getRandomValues(chunk)

    for (const value of chunk) {
      if (value >= ACCEPTANCE_BOUND) {
        continue
      }
      out += ID_ALPHABET.charAt(value % ID_ALPHABET.length)
      if (out.length === length) {
        break
      }
    }
  }

  return out
}
