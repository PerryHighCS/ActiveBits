const ID_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';

export function generateShortId(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
  }
  return out;
}
