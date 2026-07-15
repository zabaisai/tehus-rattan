import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Needed so the httpOnly device-id/refresh-token cookies set by the
  // backend (see apps/backend/src/modules/sessions) actually travel on
  // cross-origin requests (frontend and backend are different
  // subdomains in staging). Auth itself is unaffected — the JWT still
  // travels only as an Authorization: Bearer header, never a cookie.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export default api;
