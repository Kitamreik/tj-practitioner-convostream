/**
 * End-to-end password reset flow for support@convohub.dev.
 *
 * Drives the real ForgotPassword and ResetPassword page components with
 * react-testing-library against a mocked firebase/auth surface, verifying
 * the full happy path:
 *   1. User submits their email on /forgot-password
 *   2. Firebase sendPasswordResetEmail is called with a continueURL pointing
 *      at /reset-password on the current origin
 *   3. User opens /reset-password?oobCode=... — verifyPasswordResetCode is
 *      called and the resolved email is surfaced in the UI
 *   4. User submits a new password — confirmPasswordReset is called and the
 *      success screen with the "Sign In" link is shown
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const TEST_EMAIL = "support@convohub.dev";
const TEST_OOB = "test-oob-code-123";

const sendPasswordResetEmail = vi.fn().mockResolvedValue(undefined);
const verifyPasswordResetCode = vi.fn().mockResolvedValue(TEST_EMAIL);
const confirmPasswordReset = vi.fn().mockResolvedValue(undefined);

vi.mock("firebase/auth", () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmail(...args),
  verifyPasswordResetCode: (...args: unknown[]) => verifyPasswordResetCode(...args),
  confirmPasswordReset: (...args: unknown[]) => confirmPasswordReset(...args),
}));

vi.mock("@/lib/firebase", () => ({ auth: { __mock: true } }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Import after mocks are registered.
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

describe("password reset e2e (support@convohub.dev)", () => {
  beforeEach(() => {
    sendPasswordResetEmail.mockClear();
    verifyPasswordResetCode.mockClear();
    confirmPasswordReset.mockClear();
  });

  it("forgot-password sends a reset email with a /reset-password continueURL", async () => {
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: TEST_EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1));
    const [, email, opts] = sendPasswordResetEmail.mock.calls[0];
    expect(email).toBe(TEST_EMAIL);
    expect((opts as { url: string }).url).toMatch(/\/reset-password$/);

    // Confirmation screen is shown.
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(TEST_EMAIL)).toBeInTheDocument();
  });

  it("reset-password verifies the code, accepts a new password, and shows success", async () => {
    render(
      <MemoryRouter initialEntries={[`/reset-password?oobCode=${TEST_OOB}`]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );

    // Code is verified on mount and the user's email surfaces.
    await waitFor(() => expect(verifyPasswordResetCode).toHaveBeenCalledTimes(1));
    expect(verifyPasswordResetCode.mock.calls[0][1]).toBe(TEST_OOB);
    expect(await screen.findByText(TEST_EMAIL)).toBeInTheDocument();

    // Submit a matching new password.
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "NewPassword!234" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "NewPassword!234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(confirmPasswordReset).toHaveBeenCalledTimes(1));
    const [, oob, pw] = confirmPasswordReset.mock.calls[0];
    expect(oob).toBe(TEST_OOB);
    expect(pw).toBe("NewPassword!234");

    expect(await screen.findByText(/password reset!/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("reset-password shows invalid-link screen when oobCode is missing", async () => {
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(verifyPasswordResetCode).not.toHaveBeenCalled();
  });
});
