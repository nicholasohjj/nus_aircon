import { describe, test, expect } from "vitest";
import { detectCardBrand, formatCardNumber } from "../lib/cardBrand";

describe("detectCardBrand", () => {
  test("detects Visa from leading 4", () => {
    expect(detectCardBrand("4111111111111111")).toBe("visa");
    expect(detectCardBrand("4")).toBe("visa");
  });

  test("detects Mastercard from 51–55 range", () => {
    expect(detectCardBrand("5100000000000000")).toBe("mastercard");
    expect(detectCardBrand("5500000000000000")).toBe("mastercard");
  });

  test("detects Mastercard from 2221–2720 range", () => {
    expect(detectCardBrand("2221000000000000")).toBe("mastercard");
    expect(detectCardBrand("2720000000000000")).toBe("mastercard");
  });

  test("returns empty string for unknown brand", () => {
    expect(detectCardBrand("6011000000000000")).toBe(""); // Discover
    expect(detectCardBrand("3400000000000000")).toBe(""); // Amex
    expect(detectCardBrand("")).toBe("");
  });

  test("strips non-digits before detecting", () => {
    expect(detectCardBrand("4111 1111 1111 1111")).toBe("visa");
  });

  test("handles null and undefined gracefully", () => {
    expect(detectCardBrand(null)).toBe("");
    expect(detectCardBrand(undefined)).toBe("");
  });
});

describe("formatCardNumber", () => {
  test("formats 16 digits into groups of 4", () => {
    expect(formatCardNumber("4111111111111111")).toBe("4111 1111 1111 1111");
  });

  test("strips non-digit characters before formatting", () => {
    expect(formatCardNumber("4111-1111-1111-1111")).toBe("4111 1111 1111 1111");
  });

  test("truncates to 16 digits", () => {
    expect(formatCardNumber("41111111111111119999")).toBe(
      "4111 1111 1111 1111",
    );
  });

  test("handles partial input", () => {
    expect(formatCardNumber("4111")).toBe("4111");
    expect(formatCardNumber("41111111")).toBe("4111 1111");
  });

  test("handles empty string", () => {
    expect(formatCardNumber("")).toBe("");
  });
});
