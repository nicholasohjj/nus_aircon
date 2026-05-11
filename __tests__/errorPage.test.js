// tests/errorPage.test.js — new file, errorPage only
import { describe, test, expect } from "vitest";
const { errorPage } = require("../views/errorPage");

describe("errorPage", () => {
  test("returns an HTML string containing the message", () => {
    const html = errorPage("Something went wrong");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Something went wrong");
  });

  test("escapes HTML tags in the message", () => {
    const html = errorPage('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes ampersands", () => {
    const html = errorPage("Error: foo & bar");
    expect(html).toContain("foo &amp; bar");
  });

  test("handles empty message", () => {
    const html = errorPage("");
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("handles null message", () => {
    const html = errorPage(null);
    expect(html).toContain("<!DOCTYPE html>");
  });
});
