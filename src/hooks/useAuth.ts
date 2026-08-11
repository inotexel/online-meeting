import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Me {
  email: string;
  plan: "pro" | "free";
  entitled: boolean;
  entitled_until: string | null;
}

export interface AuthStatus {
  signed_in: boolean;
  me: Me | null;
  /** True when entitlement comes from the offline grace cache. */
  offline: boolean;
}

const SIGNED_OUT: AuthStatus = { signed_in: false, me: null, offline: false };

/**
 * Account session for the desktop app. Sign-in happens in the system browser
 * (Rust opens it; the pluely:// deep link brings the session back) — this hook
 * just reflects that state and re-reads it whenever Rust emits `auth-changed`.
 */
export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>(SIGNED_OUT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<AuthStatus>("auth_get_status"));
    } catch (e) {
      console.error("auth_get_status failed:", e);
      setStatus(SIGNED_OUT);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const changed = listen("auth-changed", () => {
      setError(null);
      refresh();
    });
    const failed = listen<string>("auth-error", (event) => setError(event.payload));
    return () => {
      changed.then((unlisten) => unlisten());
      failed.then((unlisten) => unlisten());
    };
  }, [refresh]);

  const signIn = useCallback(async () => {
    setError(null);
    await invoke("auth_start_sign_in");
    // Nothing else to do here: the browser flow ends in a deep link, Rust
    // completes the exchange and emits auth-changed.
  }, []);

  const signOut = useCallback(async () => {
    await invoke("auth_sign_out");
  }, []);

  return {
    ...status,
    loading,
    error,
    signIn,
    signOut,
    refresh,
  };
}
