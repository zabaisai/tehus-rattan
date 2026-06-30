import { create } from "zustand";
import { User } from "@/types";

function setCookie(name: string, value: string, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setSession: (user: User, token: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  setSession: (user, token) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("token", token);
      setCookie("token", token);
    }
    set({ user, token, isAuthenticated: true });
  },
  clearSession: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      deleteCookie("token");
    }
    set({ user: null, token: null, isAuthenticated: false });
  },
}));
