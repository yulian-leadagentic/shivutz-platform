'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { getAccessToken, decodeJwtPayload, clearTokens } from './auth';

// ─── Shape ────────────────────────────────────────────────────────────────────

export interface AuthState {
  isLoggedIn: boolean;
  userId: string | null;
  role: string | null;
  /** full_name → email → phone, whichever is available first. */
  displayName: string | null;
  /** Role within the active entity (owner/admin/operator/viewer). */
  membershipRole: string | null;
  entityId: string | null;
  entityType: 'contractor' | 'corporation' | null;
  /** True once entity context has been embedded in the JWT. */
  hasEntityContext: boolean;
}

interface AuthContextValue extends AuthState {
  logout: () => void;
  /** Call after saving new tokens to update derived state. */
  refreshAuth: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY: AuthState = {
  isLoggedIn: false,
  userId: null,
  role: null,
  displayName: null,
  membershipRole: null,
  entityId: null,
  entityType: null,
  hasEntityContext: false,
};

function parseToken(token: string | undefined): AuthState {
  if (!token) return EMPTY;
  const p = decodeJwtPayload(token);
  if (!p) return EMPTY;
  return {
    isLoggedIn: true,
    userId: (p.sub as string) ?? null,
    role: (p.role as string) ?? null,
    displayName:
      (p.full_name as string) ??
      (p.email as string) ??
      (p.phone as string) ??
      null,
    membershipRole: (p.membership_role as string) ?? null,
    entityId: (p.entity_id as string) ?? null,
    entityType: (p.entity_type as 'contractor' | 'corporation') ?? null,
    hasEntityContext: !!(p.entity_id),
  };
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy initializer parses the JWT on the FIRST render, not in a
  // useEffect. Previously the first render always saw EMPTY and any
  // child's useEffect (RoleGuard's !isLoggedIn → /login bounce) fired
  // with a stale false BEFORE this Provider's own useEffect could
  // hydrate state. Real users mostly avoided this because their
  // navigation started at /login (already-empty state was correct);
  // deep-linking to /contractor/dashboard from a warm session, or
  // Playwright's cookie-injection flow, hit it every time.
  //
  // Lazy init runs on the server as EMPTY (no document.cookie) and on
  // the client with the real token, so the first client render already
  // has the correct isLoggedIn. React will hydrate over a brief
  // mismatch on gated pages — an acceptable trade for eliminating the
  // race.
  const [state, setState] = useState<AuthState>(() =>
    typeof document === 'undefined' ? EMPTY : parseToken(getAccessToken())
  );

  const refreshAuth = useCallback(() => {
    setState(parseToken(getAccessToken()));
  }, []);

  // Still run the effect: covers the SSR → client hydration transition
  // where the server-rendered EMPTY state needs to be updated with the
  // real token on the client. On the fast client-only path (lazy init
  // above already parsed), this is a no-op setState with the same value.
  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(() => {
    clearTokens();
    setState(EMPTY);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, logout, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
