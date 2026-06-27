/**
 * Room Code Generator
 * Generates cryptographically random 6-character codes using
 * an unambiguous character set (no 0/O, 1/I/L confusion).
 */

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 31 chars, no 0/O/1/I/L
const CODE_LENGTH = 6;

/**
 * Generate a random room code.
 * Uses crypto.getRandomValues() for secure randomness.
 * @returns {string} A 6-character uppercase alphanumeric code
 */
export function generateRoomCode() {
  const array = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(array);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[array[i] % CHARSET.length];
  }
  return code;
}

/**
 * Validate that a string looks like a valid room code.
 * @param {string} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  if (!code || typeof code !== 'string') return false;
  if (code.length !== CODE_LENGTH) return false;
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}
