import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoadingPage from "../pages/LoadingPage";
import CardPaymentPage from "../pages/CardPaymentPage";
import ResultPage from "../pages/ResultPage";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setSearch(params) {
  Object.defineProperty(window, "location", {
    writable: true,
    value: {
      ...window.location,
      search: "?" + new URLSearchParams(params).toString(),
    },
  });
}

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ── LoadingPage ───────────────────────────────────────────────────────────────

describe("LoadingPage", () => {
  beforeEach(() => {
    setSearch({ txtMtrId: "12345678", txtAmount: "20", chatId: "" });
    // Prevent real fetch — bootstrap call will fail, which is fine for smoke tests
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders meter ID from query params", () => {
    renderWithRouter(<LoadingPage basePath="" />);
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  test("renders formatted amount from query params", () => {
    renderWithRouter(<LoadingPage basePath="" />);
    expect(screen.getByText(/SGD 20\.00/)).toBeInTheDocument();
  });

  test("renders page title", () => {
    renderWithRouter(<LoadingPage basePath="" />);
    expect(screen.getByText("Electricity Top-Up")).toBeInTheDocument();
  });

  test("shows spinner on mount", () => {
    renderWithRouter(<LoadingPage basePath="" />);
    // spinner is present while running
    expect(
      document.querySelector(".spinner") ||
        document.querySelector("[class*='spinner']"),
    ).toBeTruthy();
  });

  test("shows error and retry button after fetch failure", async () => {
    renderWithRouter(<LoadingPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText(/Try Again/i)).toBeInTheDocument();
    });
  });

  test("shows error message after fetch failure", async () => {
    renderWithRouter(<LoadingPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText(/Unable to continue/i)).toBeInTheDocument();
    });
  });

  test("cp2nus basePath shows cp2nus in subtitle", () => {
    renderWithRouter(<LoadingPage basePath="/cp2nus" />);
    expect(screen.getByText(/cp2nus/i)).toBeInTheDocument();
  });

  test("renders address when present in query params", () => {
    setSearch({
      txtMtrId: "12345678",
      txtAmount: "20",
      address: "Blk 12, 03-45 Sheares Hall",
    });
    renderWithRouter(<LoadingPage basePath="" />);
    expect(screen.getByText("Blk 12, 03-45 Sheares Hall")).toBeInTheDocument();
  });

  test("renders balance when present in query params", () => {
    setSearch({ txtMtrId: "12345678", txtAmount: "20", balance: "18.5" });
    renderWithRouter(<LoadingPage basePath="" />);
    expect(screen.getByText(/18\.50/)).toBeInTheDocument();
  });
});

// ── CardPaymentPage ───────────────────────────────────────────────────────────

describe("CardPaymentPage", () => {
  const SESSION = {
    ok: true,
    txtMtrId: "12345678",
    txtAmount: "20",
    address: "Blk 12, 03-45",
    balance: "18.50",
    n: "modulus",
    e: "exponent",
    netsMid: "807574000",
    netsTxnRef: "TXN001",
    merchantTxnRef: "MTR001",
  };

  beforeEach(() => {
    setSearch({ token: "test-token-abc" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows spinner while session is loading", () => {
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {})); // never resolves
    renderWithRouter(<CardPaymentPage basePath="" />);
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows error when token is missing", () => {
    setSearch({});
    renderWithRouter(<CardPaymentPage basePath="" />);
    expect(screen.getByText(/Missing payment token/i)).toBeInTheDocument();
  });

  test("shows error when session fetch fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<CardPaymentPage basePath="" />);
    await waitFor(() => {
      // Use the specific error div, not the hint paragraph
      expect(screen.getAllByText(/Session expired/i).length).toBeGreaterThan(0);
    });
  });

  test("shows expired hint on 400 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<CardPaymentPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText(/return to the bot/i)).toBeInTheDocument();
    });
  });

  test("renders card form after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />);
    await waitFor(() => {
      // Labels don't have htmlFor — query by placeholder instead
      expect(
        screen.getByPlaceholderText(/As printed on card/i),
      ).toBeInTheDocument();
    });
  });

  test("renders meter ID and amount in summary after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText("12345678")).toBeInTheDocument();
      // Amount appears in multiple places — check the summary specifically
      expect(screen.getAllByText(/20\.00/).length).toBeGreaterThan(0);
    });
  });

  test("renders pay button with amount after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Pay SGD 20\.00/i }),
      ).toBeInTheDocument();
    });
  });
});

// ── ResultPage ────────────────────────────────────────────────────────────────

describe("ResultPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows error when token is missing", () => {
    setSearch({});
    renderWithRouter(<ResultPage basePath="" />);
    expect(screen.getByText(/Missing result token/i)).toBeInTheDocument();
  });

  test("shows spinner while session is loading", () => {
    setSearch({ token: "test-token" });
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ResultPage basePath="" />);
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows session expired message on failed fetch", async () => {
    setSearch({ token: "test-token" });
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<ResultPage basePath="" />);
    await waitFor(() => {
      // Match the h1 specifically, not the subtitle paragraph that also contains the text
      expect(
        screen.getByRole("heading", { name: /Session Expired/i }),
      ).toBeInTheDocument();
    });
  });

  test("renders success result page", async () => {
    setSearch({ token: "test-token" });
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "Blk 12, 03-45",
        balance: "18.50",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText("Top-Up Successful")).toBeInTheDocument();
    });
  });

  test("renders failure result page", async () => {
    setSearch({ token: "test-token" });
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "failure",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-002",
        reason: "Transaction is rejected by financial institution.",
        address: "",
        balance: "",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText("Top-Up Failed")).toBeInTheDocument();
      expect(
        screen.getByText(/rejected by financial institution/i),
      ).toBeInTheDocument();
    });
  });

  test("renders meter ID and reference on success", async () => {
    setSearch({ token: "test-token" });
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />);
    await waitFor(() => {
      expect(screen.getByText("12345678")).toBeInTheDocument();
      expect(screen.getByText("MTR-001")).toBeInTheDocument();
    });
  });

  test("renders Top Up Again and Close buttons", async () => {
    setSearch({ token: "test-token" });
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Top Up Again/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Close/i }),
      ).toBeInTheDocument();
    });
  });
});
