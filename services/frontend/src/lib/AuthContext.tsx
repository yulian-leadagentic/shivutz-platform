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
  const [state, setState] = useState<AuthState>(EMPTY);

  const refreshAuth = useCallback(() => {
    setState(parseToken(getAccessToken()));
  }, []);

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
