import { describe, test, expect } from "vitest";
import { validateCardForm } from "../lib/validation";

// Valid base input that passes all rules
const VALID = {
  name: "John Doe",
  email: "john@example.com",
  cardNo: "4111 1111 1111 1111",
  expMth: "12",
  expYr: "27",
  cvv: "123",
};

describe("validateCardForm — valid input", () => {
  test("returns valid=true for a complete Visa card", () => {
    const result = validateCardForm(VALID);
    expect(result.valid).toBe(true);
  });

  test("returns valid=true for a Mastercard", () => {
    const result = validateCardForm({
      ...VALID,
      cardNo: "5100 0000 0000 0000",
    });
    expect(result.valid).toBe(true);
  });

  test("data.card strips spaces from card number", () => {
    const result = validateCardForm(VALID);
    expect(result.data.card).toBe("4111111111111111");
  });

  test("data.mth is zero-padded", () => {
    const result = validateCardForm({ ...VALID, expMth: "3" });
    expect(result.data.mth).toBe("03");
  });

  test("data.name is trimmed", () => {
    const result = validateCardForm({ ...VALID, name: "  John Doe  " });
    expect(result.data.name).toBe("John Doe");
  });

  test("data.email is trimmed", () => {
    const result = validateCardForm({
      ...VALID,
      email: "  john@example.com  ",
    });
    expect(result.data.email).toBe("john@example.com");
  });
});

describe("validateCardForm — name validation", () => {
  test("rejects empty name", () => {
    const result = validateCardForm({ ...VALID, name: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  test("rejects whitespace-only name", () => {
    const result = validateCardForm({ ...VALID, name: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });
});

describe("validateCardForm — email validation", () => {
  test("rejects empty email", () => {
    const result = validateCardForm({ ...VALID, email: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  test("rejects email without @", () => {
    const result = validateCardForm({ ...VALID, email: "notanemail" });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  test("rejects email without domain", () => {
    const result = validateCardForm({ ...VALID, email: "john@" });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });
});

describe("validateCardForm — card number validation", () => {
  test("rejects empty card number", () => {
    const result = validateCardForm({ ...VALID, cardNo: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.cardNo).toBeDefined();
  });

  test("rejects card number with fewer than 13 digits", () => {
    const result = validateCardForm({ ...VALID, cardNo: "411111111111" });
    expect(result.valid).toBe(false);
    expect(result.errors.cardNo).toBeDefined();
  });

  test("rejects non-Visa, non-Mastercard cards", () => {
    // Discover
    const result = validateCardForm({ ...VALID, cardNo: "6011111111111117" });
    expect(result.valid).toBe(false);
    expect(result.errors.cardNo).toMatch(/Visa.*Mastercard|Mastercard.*Visa/i);
  });

  test("rejects card numbers with letters", () => {
    const result = validateCardForm({ ...VALID, cardNo: "4111111111111abc" });
    expect(result.valid).toBe(false);
    expect(result.errors.cardNo).toBeDefined();
  });
});

describe("validateCardForm — expiry validation", () => {
  test("rejects month 0", () => {
    const result = validateCardForm({ ...VALID, expMth: "0" });
    expect(result.valid).toBe(false);
    expect(result.errors.expMth).toBeDefined();
  });

  test("rejects month 13", () => {
    const result = validateCardForm({ ...VALID, expMth: "13" });
    expect(result.valid).toBe(false);
    expect(result.errors.expMth).toBeDefined();
  });

  test("rejects non-numeric month", () => {
    const result = validateCardForm({ ...VALID, expMth: "ab" });
    expect(result.valid).toBe(false);
    expect(result.errors.expMth).toBeDefined();
  });

  test("rejects single-digit year", () => {
    const result = validateCardForm({ ...VALID, expYr: "7" });
    expect(result.valid).toBe(false);
    expect(result.errors.expYr).toBeDefined();
  });

  test("rejects 4-digit year", () => {
    const result = validateCardForm({ ...VALID, expYr: "2027" });
    expect(result.valid).toBe(false);
    expect(result.errors.expYr).toBeDefined();
  });

  test("rejects non-numeric year", () => {
    const result = validateCardForm({ ...VALID, expYr: "ab" });
    expect(result.valid).toBe(false);
    expect(result.errors.expYr).toBeDefined();
  });
});

describe("validateCardForm — CVV validation", () => {
  test("rejects empty CVV", () => {
    const result = validateCardForm({ ...VALID, cvv: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.cvv).toBeDefined();
  });

  test("rejects 2-digit CVV", () => {
    const result = validateCardForm({ ...VALID, cvv: "12" });
    expect(result.valid).toBe(false);
    expect(result.errors.cvv).toBeDefined();
  });

  test("accepts 4-digit CVV", () => {
    const result = validateCardForm({ ...VALID, cvv: "1234" });
    expect(result.valid).toBe(true);
  });

  test("rejects non-numeric CVV", () => {
    const result = validateCardForm({ ...VALID, cvv: "12a" });
    expect(result.valid).toBe(false);
    expect(result.errors.cvv).toBeDefined();
  });
});

describe("validateCardForm — multiple errors", () => {
  test("collects all errors at once", () => {
    const result = validateCardForm({
      name: "",
      email: "",
      cardNo: "",
      expMth: "",
      expYr: "",
      cvv: "",
    });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(5);
  });
});
