import { describe, test, expect, beforeEach, vi } from "vitest";
import { encryptCard } from "../lib/rsa";

// The eNETS RSA scripts set window.RSAKey — we mock it here
// since the actual scripts are loaded via <script> tags at runtime.

describe("encryptCard", () => {
  beforeEach(() => {
    // Reset window.RSAKey before each test
    delete window.RSAKey;
  });

  test("throws when RSAKey is not loaded", () => {
    expect(() =>
      encryptCard("modulus", "exponent", "4111111111111111", "123"),
    ).toThrow("eNETS RSA library not loaded");
  });

  test("throws when RSA encryption returns null/falsy", () => {
    window.RSAKey = class {
      setPublic() {}
      encrypt() {
        return null;
      }
    };
    expect(() => encryptCard("mod", "exp", "4111111111111111", "123")).toThrow(
      "RSA encryption failed",
    );
  });

  test("returns string starting with 'RSA'", () => {
    window.RSAKey = class {
      setPublic() {}
      encrypt() {
        return "abc123";
      }
    };
    const result = encryptCard("mod", "exp", "4111111111111111", "123");
    expect(result.startsWith("RSA")).toBe(true);
  });

  test("calls setPublic with modulus and exponent", () => {
    const setPublic = vi.fn();
    window.RSAKey = class {
      setPublic(...args) {
        setPublic(...args);
      }
      encrypt() {
        return "hex";
      }
    };
    encryptCard("my-modulus", "my-exponent", "4111111111111111", "123");
    expect(setPublic).toHaveBeenCalledWith("my-modulus", "my-exponent");
  });

  test("encrypts correct plaintext format", () => {
    let captured;
    window.RSAKey = class {
      setPublic() {}
      encrypt(text) {
        captured = text;
        return "hex";
      }
    };
    encryptCard("mod", "exp", "4111111111111111", "999");
    expect(captured).toBe("cardNo=4111111111111111,cvv=999");
  });

  test("inserts line breaks every 2048 chars for long ciphertext", () => {
    const longHex = "a".repeat(3000);
    window.RSAKey = class {
      setPublic() {}
      encrypt() {
        return longHex;
      }
    };
    const result = encryptCard("mod", "exp", "4111111111111111", "123");
    expect(result).toContain("\n");
  });

  test("does not insert line breaks for short ciphertext", () => {
    window.RSAKey = class {
      setPublic() {}
      encrypt() {
        return "shortresult";
      }
    };
    const result = encryptCard("mod", "exp", "4111111111111111", "123");
    // "RSA" + "shortresult" — no newline needed
    expect(result).toBe("RSAshortresult");
  });
});
