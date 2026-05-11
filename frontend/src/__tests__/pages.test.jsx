import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoadingPage from "../pages/LoadingPage";
import CardPaymentPage from "../pages/CardPaymentPage";
import ResultPage from "../pages/ResultPage";
import HomePage from "../pages/HomePage";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Renders ui inside a MemoryRouter whose location includes the given search
 * params. useSearchParams() reads from the Router context, not window.location,
 * so this is the only way to reliably inject query params in tests.
 */
function renderWithRouter(ui, params = {}) {
  const search = Object.keys(params).length
    ? "?" + new URLSearchParams(params).toString()
    : "";
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/", search }]}>
      {ui}
    </MemoryRouter>,
  );
}

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

// ── LoadingPage ───────────────────────────────────────────────────────────────

describe("LoadingPage", () => {
  const BASE_PARAMS = { txtMtrId: "12345678", txtAmount: "20", chatId: "" };

  beforeEach(() => {
    // Prevent real fetch — bootstrap call will fail, which is fine for smoke tests
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders meter ID from query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  test("renders formatted amount from query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(screen.getByText(/SGD 20\.00/)).toBeInTheDocument();
  });

  test("renders page title", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(screen.getByText("Electricity Top-Up")).toBeInTheDocument();
  });

  test("shows spinner on mount", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows error and retry button after fetch failure", async () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    await waitFor(() => {
      expect(screen.getByText(/Try Again/i)).toBeInTheDocument();
    });
  });

  test("shows error message after fetch failure", async () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    await waitFor(() => {
      expect(screen.getByText(/Unable to continue/i)).toBeInTheDocument();
    });
  });

  test("cp2nus basePath shows cp2nus in subtitle", () => {
    renderWithRouter(<LoadingPage basePath="/cp2nus" />, BASE_PARAMS);
    expect(screen.getByText(/cp2nus/i)).toBeInTheDocument();
  });

  test("renders address when present in query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, {
      ...BASE_PARAMS,
      address: "Blk 12, 03-45 Sheares Hall",
    });
    expect(screen.getByText("Blk 12, 03-45 Sheares Hall")).toBeInTheDocument();
  });

  test("renders balance when present in query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, {
      ...BASE_PARAMS,
      balance: "18.5",
    });
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

  const TOKEN_PARAMS = { token: "test-token-abc" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows spinner while session is loading", () => {
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {})); // never resolves
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows error when token is missing", () => {
    renderWithRouter(<CardPaymentPage basePath="" />, {});
    expect(screen.getByText(/Missing payment token/i)).toBeInTheDocument();
  });

  test("shows error when session fetch fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(screen.getAllByText(/Session expired/i).length).toBeGreaterThan(0);
    });
  });

  test("shows expired hint on 400 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
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
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
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
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(screen.getByText("12345678")).toBeInTheDocument();
      expect(screen.getAllByText(/20\.00/).length).toBeGreaterThan(0);
    });
  });

  test("renders pay button with amount after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
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
    renderWithRouter(<ResultPage basePath="" />, {});
    expect(screen.getByText(/Missing result token/i)).toBeInTheDocument();
  });

  test("shows spinner while session is loading", () => {
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows session expired message on failed fetch", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Session Expired/i }),
      ).toBeInTheDocument();
    });
  });

  test("renders success result page", async () => {
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
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(screen.getByText("Top-Up Successful")).toBeInTheDocument();
    });
  });

  test("renders failure result page", async () => {
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
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(screen.getByText("Top-Up Failed")).toBeInTheDocument();
      expect(
        screen.getByText(/rejected by financial institution/i),
      ).toBeInTheDocument();
    });
  });

  test("renders meter ID and reference on success", async () => {
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
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(screen.getByText("12345678")).toBeInTheDocument();
      expect(screen.getByText("MTR-001")).toBeInTheDocument();
    });
  });

  test("renders Top Up Again and Close buttons", async () => {
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
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
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

// ── HomePage ──────────────────────────────────────────────────────────────────

describe("HomePage › static rendering", () => {
  test("renders page title", () => {
    renderHomePage();
    expect(
      screen.getByRole("heading", { name: /Electricity Top-Up/i }),
    ).toBeInTheDocument();
  });

  test("renders hostel group buttons", () => {
    renderHomePage();
    expect(screen.getByText(/PGPR.*Residential Colleges/i)).toBeInTheDocument();
    expect(screen.getByText(/UTown Residence/i)).toBeInTheDocument();
  });

  test("renders meter ID input", () => {
    renderHomePage();
    expect(
      screen.getByPlaceholderText(/8-digit meter ID/i),
    ).toBeInTheDocument();
  });

  test("renders amount input", () => {
    renderHomePage();
    expect(screen.getByPlaceholderText(/6\.00/i)).toBeInTheDocument();
  });

  test("renders all four preset buttons", () => {
    renderHomePage();
    expect(screen.getByRole("button", { name: "$10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$20" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$50" })).toBeInTheDocument();
  });

  test("renders continue button", () => {
    renderHomePage();
    expect(
      screen.getByRole("button", { name: /Continue/i }),
    ).toBeInTheDocument();
  });
});

describe("HomePage › hostel selection", () => {
  test("no group is active on initial render", () => {
    renderHomePage();
    const pgprBtn = screen.getByText(/PGPR.*Residential Colleges/i);
    expect(pgprBtn.className).not.toMatch(/Active/i);
  });

  test("clicking a group marks it active", () => {
    renderHomePage();
    const pgprBtn = screen.getByText(/PGPR.*Residential Colleges/i);
    fireEvent.click(pgprBtn);
    expect(pgprBtn.className).toMatch(/Active/i);
  });

  test("clicking second group deactivates the first", () => {
    renderHomePage();
    const pgprBtn = screen.getByText(/PGPR.*Residential Colleges/i);
    const utownBtn = screen.getByText(/UTown Residence/i);
    fireEvent.click(pgprBtn);
    fireEvent.click(utownBtn);
    expect(pgprBtn.className).not.toMatch(/Active/i);
    expect(utownBtn.className).toMatch(/Active/i);
  });
});

describe("HomePage › amount presets", () => {
  test("clicking $20 preset fills the amount input", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: "$20" }));
    expect(screen.getByPlaceholderText(/6\.00/i).value).toBe("20");
  });

  test("clicking a preset marks it active", () => {
    renderHomePage();
    const btn = screen.getByRole("button", { name: "$30" });
    fireEvent.click(btn);
    expect(btn.className).toMatch(/Active/i);
  });

  test("clicking a different preset deactivates the previous one", () => {
    renderHomePage();
    const btn10 = screen.getByRole("button", { name: "$10" });
    const btn50 = screen.getByRole("button", { name: "$50" });
    fireEvent.click(btn10);
    fireEvent.click(btn50);
    expect(btn10.className).not.toMatch(/Active/i);
    expect(btn50.className).toMatch(/Active/i);
  });
});

describe("HomePage › validation", () => {
  test("shows all three errors when form is submitted empty", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/Please select your hostel/i)).toBeInTheDocument();
    expect(screen.getByText(/Must be exactly 8 digits/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
  });

  test("shows meter ID error for non-8-digit input", () => {
    renderHomePage();
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/Must be exactly 8 digits/i)).toBeInTheDocument();
  });

  test("shows amount error when amount is below minimum", () => {
    renderHomePage();
    fireEvent.change(screen.getByPlaceholderText(/6\.00/i), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
  });

  test("shows amount error when amount exceeds maximum", () => {
    renderHomePage();
    fireEvent.change(screen.getByPlaceholderText(/6\.00/i), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
  });

  test("meter ID field strips non-numeric characters", () => {
    renderHomePage();
    const input = screen.getByPlaceholderText(/8-digit meter ID/i);
    fireEvent.change(input, { target: { value: "abc12345xyz" } });
    expect(input.value).toBe("12345");
  });

  test("meter ID field enforces 8 character maximum", () => {
    renderHomePage();
    const input = screen.getByPlaceholderText(/8-digit meter ID/i);
    fireEvent.change(input, { target: { value: "123456789" } });
    expect(input.value).toBe("12345678");
  });

  test("clears meter ID error after correcting input", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/Must be exactly 8 digits/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "12345678" },
    });
    expect(
      screen.queryByText(/Must be exactly 8 digits/i),
    ).not.toBeInTheDocument();
  });

  test("clears amount error after correcting input", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/6\.00/i), {
      target: { value: "20" },
    });
    expect(
      screen.queryByText(/Between \$6\.00 and \$50\.00/i),
    ).not.toBeInTheDocument();
  });
});

describe("HomePage › submission", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("navigates to cp2 webapp URL on valid PGPR submission", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(screen.getByText(/PGPR.*Residential Colleges/i));
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "$20" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/webapp?"));
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtMtrId=12345678"),
    );
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtAmount=20"),
    );
    // cp2 (PGPR) uses the root basePath — no /cp2nus prefix
    expect(assignSpy).toHaveBeenCalledWith(
      expect.not.stringContaining("cp2nus"),
    );
  });

  test("navigates to cp2nus webapp URL on valid UTown submission", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(screen.getByText(/UTown Residence/i));
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "87654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "$10" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("/cp2nus/webapp?"),
    );
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtMtrId=87654321"),
    );
  });

  test("does not navigate when form is invalid", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
