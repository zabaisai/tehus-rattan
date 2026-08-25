import api from "./axios";
import { AuthResponse, User } from "@/types";

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", {
    email,
    password,
  });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

// Closes only this browser's session (identified by its httpOnly
// refresh-token cookie) — never other devices.
export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

// Password recovery. The response is intentionally generic (never reveals
// whether an account exists), so callers show the same message regardless.
export async function forgotPassword(email: string): Promise<void> {
  await api.post("/auth/forgot-password", { email });
}

export async function resetPassword(
  token: string,
  password: string,
  passwordConfirmation: string,
): Promise<void> {
  await api.post("/auth/reset-password", {
    token,
    password,
    passwordConfirmation,
  });
}
