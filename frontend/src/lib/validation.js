import { detectCardBrand } from "./cardBrand";

/**
 * Validate the card payment form fields.
 *
 * @param {{ name, email, cardNo, expMth, expYr, cvv }} fields
 * @returns {{ valid: true, data: object } | { valid: false, errors: object }}
 */
export function validateCardForm({ name, email, cardNo, expMth, expYr, cvv }) {
  const errors = {};

  if (!name.trim()) {
    errors.name = "Required";
  }

  if (!email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) {
    errors.email = "Valid email required";
  }

  const rawCard = cardNo.replace(/\s/g, "");
  if (
    !rawCard ||
    rawCard.length < 13 ||
    rawCard.length > 19 ||
    !/^\d+$/.test(rawCard)
  ) {
    errors.cardNo = "Enter a valid card number";
  } else {
    const brand = detectCardBrand(rawCard);
    if (brand !== "visa" && brand !== "mastercard") {
      errors.cardNo = "Only Visa and Mastercard are accepted";
    }
  }

  const mInt = parseInt(expMth, 10);
  if (!expMth || isNaN(mInt) || mInt < 1 || mInt > 12) {
    errors.expMth = "01–12";
  }

  if (!expYr || expYr.length !== 2 || !/^\d{2}$/.test(expYr)) {
    errors.expYr = "2-digit year";
  }

  if (!cvv || cvv.length < 3 || !/^\d+$/.test(cvv)) {
    errors.cvv = "3–4 digits";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name: name.trim(),
      email: email.trim(),
      card: rawCard,
      mth: String(mInt).padStart(2, "0"),
      yr: expYr,
      cvv,
    },
  };
}
