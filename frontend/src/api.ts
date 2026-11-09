// Auth client for the FastAPI backend. Passwords only ever travel in the request
// body to /auth/*; they are never stored or logged here.

const TOKEN_KEY = "trademind.token";
export const SESSION_EXPIRED_EVENT = "trademind:session-expired";

/** Feature flags for flows the backend does not support yet (REQ-0103). */
export const AUTH_FEATURES = {
  signUp: true,
  passwordRecovery: false,
  googleSignIn: false,
};

export type User = { id: string; email: string; created_at: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeStorage("local")?.getItem(TOKEN_KEY) ?? safeStorage("session")?.getItem(TOKEN_KEY) ?? null;
}

/** "Remember me" keeps the token across browser restarts; otherwise it lasts for the tab session. */
export function setToken(token: string | null, remember = true): void {
  safeStorage("local")?.removeItem(TOKEN_KEY);
  safeStorage("session")?.removeItem(TOKEN_KEY);
  if (token) {
    safeStorage(remember ? "local" : "session")?.setItem(TOKEN_KEY, token);
  }
}

function errorMessage(status: number, data: unknown): string {
  if (typeof data === "object" && data !== null && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
      return String(detail[0].msg).replace(/^Value error, /, "");
    }
  }
  if (status === 422) return "Check your email and password. Passwords need at least 12 characters.";
  if (status >= 500) return "The server had a problem. Please try again shortly.";
  return `Request failed (${status})`;
}

async function request<T>(path: string, options: RequestInit = {}, token = getToken()): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError("Can't reach the TradeMind server. Check your connection and try again.", 0);
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token && !path.startsWith("/auth/login")) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(errorMessage(response.status, data), response.status);
  }
  return data as T;
}

export function signUp(email: string, password: string): Promise<User> {
  return request<User>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function currentUser(): Promise<User> {
  return request<User>("/auth/me");
}

export async function logIn(email: string, password: string, remember = true): Promise<User> {
  const { access_token } = await request<{ access_token: string }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    null,
  );
  setToken(access_token, remember);
  return currentUser();
}

export async function logOut(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST" });
  } finally {
    setToken(null);
  }
}

/**
 * Re-authentication for sensitive changes (REQ-0802). Verifies the password by
 * opening a throwaway session and immediately revoking it; the current session is untouched.
 */
export async function confirmPassword(email: string, password: string): Promise<void> {
  const { access_token } = await request<{ access_token: string }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    null,
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError("That password is incorrect.", 401);
    }
    throw error;
  });
  await request<void>("/auth/logout", { method: "POST" }, access_token).catch(() => undefined);
}
