import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AuthUser = {
  id: number;
  companyId: number;
  companyName: string;
  companySlug: string;
  name: string;
  email: string;
  role: "admin" | "worker";
  subcontractorId: number | null;
};

type SetupStatus = {
  configured: boolean;
  adminEmailConfigured: boolean;
  adminPasswordConfigured: boolean;
  workerConfigured: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  setupStatus: SetupStatus | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (input: {
    accountType: "company" | "admin" | "worker";
    companyName?: string;
    companyCode?: string;
    name: string;
    email: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSetupStatus() {
  const response = await fetch("/api/auth/setup-status", { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as SetupStatus;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [meResponse, setup] = await Promise.all([
        fetch("/api/auth/me", { credentials: "include" }),
        fetchSetupStatus(),
      ]);
      setSetupStatus(setup);
      if (meResponse.ok) {
        const data = (await meResponse.json()) as { user: AuthUser };
        setUser(data.user);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      if (data?.setup) setSetupStatus(data.setup);
      return { ok: false, error: data?.error ?? "Could not sign in" };
    }

    const data = (await response.json()) as { user: AuthUser };
    setUser(data.user);
    return { ok: true };
  }, []);

  const register = useCallback(async (input: {
    accountType: "company" | "admin" | "worker";
    companyName?: string;
    companyCode?: string;
    name: string;
    email: string;
    password: string;
  }) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return { ok: false, error: data?.error ?? "Could not create account" };
    }

    const data = (await response.json()) as { user: AuthUser };
    setUser(data.user);
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setupStatus, loading, login, register, logout, refresh }),
    [user, setupStatus, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
