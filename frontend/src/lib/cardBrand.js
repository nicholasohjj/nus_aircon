/**
 * Detect card brand from leading digits.
 * Returns 'visa' | 'mastercard' | ''
 */
export function detectCardBrand(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (/^4/.test(d)) return "visa";

  const first2 = Number(d.slice(0, 2));
  const first4 = Number(d.slice(0, 4));
  if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) {
    return "mastercard";
  }

  return "";
}

/**
 * Format a raw digit string as "•••• •••• •••• ••••"
 */
export function formatCardNumber(raw) {
  const digits = raw.replace(/\D/g, "").substring(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}
