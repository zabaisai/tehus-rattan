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

export async function register(payload: {
  companyName: string;
  name: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/register", payload);
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
