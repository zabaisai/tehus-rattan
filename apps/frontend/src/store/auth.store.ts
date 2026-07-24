import { create } from "zustand";
import { User } from "@/types";
import {
  setAccessToken,
  clearAccessToken,
} from "@/lib/auth-token";

// Auth lifecycle:
// - "bootstrapping": app just loaded; a controlled /auth/refresh is deciding
//   whether there is a live session. Protected views must wait in this state.
// - "authenticated": a user is known and an access token is in memory.
// - "anonymous": no session (refresh failed / logged out).
export type AuthStatus = "bootstrapping" | "authenticated" | "anonymous";

interface AuthState {
  user: User | null;
  status: AuthStatus;
  // Stores the user in state and the access token ONLY in memory (never
  // persisted). Marks the session authenticated.
  setSession: (user: User, token: string) => void;
  // Update the user object without touching the token/status (e.g. after
  // /auth/me backfills role/companyId).
  setUser: (user: User) => void;
  setStatus: (status: AuthStatus) => void;
  // Clears the in-memory token and user; marks the session anonymous.
  clearSession: () => void;
}

// The store holds user + status only. The JWT is deliberately NOT a field here
// (it lives in lib/auth-token.ts memory) so it can never be serialized by
// devtools, a future `persist` middleware, or SSR hydration.
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "bootstrapping",
  setSession: (user, token) => {
    setAccessToken(token);
    set({ user, status: "authenticated" });
  },
  setUser: (user) => set({ user }),
  setStatus: (status) => set({ status }),
  clearSession: () => {
    clearAccessToken();
    set({ user: null, status: "anonymous" });
  },
}));
