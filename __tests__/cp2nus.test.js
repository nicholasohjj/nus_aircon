import { describe, test, expect } from "vitest";

const {
  buildPayDisplayAddress,
  buildEnetsPayUrl,
} = require("../services/cp2nusService");

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FULL_METER_INFO = {
  premise: {
    block: "12",
    level: "03",
    unit: "45",
    building: "Sheares Hall",
  },
  address: "Block 12, 03-45 Sheares Hall, University Road, Singapore 119076",
  credit_bal: 18.5,
};

const MINIMAL_METER_INFO = {
  premise: { block: "5", level: "02", unit: "10", building: "" },
  address: "Block 5, 02-10, Some Road, Singapore 123456",
};

// ── buildPayDisplayAddress ────────────────────────────────────────────────────

describe("buildPayDisplayAddress", () => {
  test("formats a full meter info object correctly", () => {
    const result = buildPayDisplayAddress(FULL_METER_INFO);
    expect(result).toContain("12");
    expect(result).toContain("03-45");
    expect(result).toContain("Sheares Hall");
  });

  test("returns empty string for null input", () => {
    expect(buildPayDisplayAddress(null)).toBe("");
  });

  test("returns empty string for undefined input", () => {
    expect(buildPayDisplayAddress(undefined)).toBe("");
  });

  test("handles missing premise fields gracefully", () => {
    const result = buildPayDisplayAddress({
      premise: {},
      address: "Some Address",
    });
    expect(typeof result).toBe("string");
  });

  test("handles missing premise object entirely", () => {
    const result = buildPayDisplayAddress({ address: "Fallback Address" });
    expect(typeof result).toBe("string");
  });

  test("strips the redundant Block prefix from address tail", () => {
    const result = buildPayDisplayAddress(FULL_METER_INFO);
    // Should not have "Block 12, 03-45 Sheares Hall, Block 12..." duplication
    const blockCount = (result.match(/Block 12/g) || []).length;
    expect(blockCount).toBeLessThanOrEqual(1);
  });

  test("handles empty building name", () => {
    const result = buildPayDisplayAddress(MINIMAL_METER_INFO);
    expect(result).toContain("5");
    expect(result).toContain("02-10");
  });

  test("trims whitespace from output", () => {
    const result = buildPayDisplayAddress(FULL_METER_INFO);
    expect(result).toBe(result.trim());
  });
});

// ── buildEnetsPayUrl ──────────────────────────────────────────────────────────

describe("buildEnetsPayUrl", () => {
  const BASE_ARGS = {
    req: "test-req-token",
    sign: "test-sign-token",
    username: "12345678",
    amount: 20,
    address: "Blk 12, 03-45 Sheares Hall",
  };

  test("returns a URL string", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^https?:\/\//);
  });

  test("contains a base64-encoded p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    expect(p).toBeTruthy();
    // Should be valid base64
    expect(() => Buffer.from(p, "base64").toString("utf8")).not.toThrow();
  });

  test("encodes req and sign into the p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    expect(inner).toContain("test-req-token");
    expect(inner).toContain("test-sign-token");
  });

  test("encodes username into the p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    // m= is base64 of username
    const mMatch = inner.match(/m=([^&]+)/);
    expect(mMatch).toBeTruthy();
    expect(Buffer.from(mMatch[1], "base64").toString("utf8")).toBe("12345678");
  });

  test("formats amount to 2 decimal places", () => {
    const url = buildEnetsPayUrl({ ...BASE_ARGS, amount: 6 });
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    // a= is base64 of "6.00"
    const aMatch = inner.match(/a=([^&]+)/);
    expect(aMatch).toBeTruthy();
    expect(Buffer.from(aMatch[1], "base64").toString("utf8")).toBe("6.00");
  });

  test("encodes address into the p parameter", () => {
    const url = buildEnetsPayUrl(BASE_ARGS);
    const parsed = new URL(url);
    const p = parsed.searchParams.get("p");
    const inner = Buffer.from(p, "base64").toString("utf8");
    const dMatch = inner.match(/d=([^&]+)/);
    expect(dMatch).toBeTruthy();
    expect(Buffer.from(dMatch[1], "base64").toString("utf8")).toBe(
      "Blk 12, 03-45 Sheares Hall",
    );
  });

  test("handles empty address", () => {
    const url = buildEnetsPayUrl({ ...BASE_ARGS, address: "" });
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^https?:\/\//);
  });

  test("produces different URLs for different amounts", () => {
    const url1 = buildEnetsPayUrl({ ...BASE_ARGS, amount: 10 });
    const url2 = buildEnetsPayUrl({ ...BASE_ARGS, amount: 20 });
    expect(url1).not.toBe(url2);
  });

  test("produces different URLs for different usernames", () => {
    const url1 = buildEnetsPayUrl({ ...BASE_ARGS, username: "11111111" });
    const url2 = buildEnetsPayUrl({ ...BASE_ARGS, username: "22222222" });
    expect(url1).not.toBe(url2);
  });
});
