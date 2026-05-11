/**
 * Wrapper around the eNETS RSA scripts loaded as global <script> tags in index.html:
 *   https://www.enets.sg/GW2/js/jsbn.js
 *   https://www.enets.sg/GW2/js/prng4.js
 *   https://www.enets.sg/GW2/js/rng.js
 *   https://www.enets.sg/GW2/js/rsa.js
 *
 * These set window.RSAKey — we never import them through Vite.
 */

function linebrk(str, maxLen) {
  let out = "";
  let i = 0;
  while (i + maxLen < str.length) {
    out += str.substring(i, i + maxLen) + "\n";
    i += maxLen;
  }
  return out + str.substring(i);
}

/**
 * Encrypt card details with the eNETS public key.
 * @param {string} modulus  - RSA_N from session
 * @param {string} exponent - RSA_E from session
 * @param {string} cardNo   - raw card number digits
 * @param {string} cvv      - raw CVV digits
 * @returns {string} "RSA" + line-broken hex ciphertext
 */
export function encryptCard(modulus, exponent, cardNo, cvv) {
  const RSAKey = window.RSAKey;
  if (!RSAKey) throw new Error("eNETS RSA library not loaded");

  const rsa = new RSAKey();
  rsa.setPublic(modulus, exponent);

  const plaintext = `cardNo=${cardNo},cvv=${cvv}`;
  const result = rsa.encrypt(plaintext);

  if (!result) throw new Error("RSA encryption failed");

  return "RSA" + linebrk(result, 2048);
}
