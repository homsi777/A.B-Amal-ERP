import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchMe, type AuthUser } from '../lib/api/authApi';
import {
  canAccessPath,
  canSeeNavItem,
  getDefaultLandingPath,
  hasPermission,
  isAdmin,
} from '../lib/auth/accessControl';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  isAdmin: boolean;
  hasPermission: (code: string) => boolean;
  canSeeNavItem: (key: string) => boolean;
  canAccessPath: (pathname: string) => boolean;
  defaultLandingPath: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  const refresh = async () => {
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [location.pathname]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refresh,
      isAdmin: isAdmin(user),
      hasPermission: (code) => hasPermission(user, code),
      canSeeNavItem: (key) => canSeeNavItem(user, key),
      canAccessPath: (pathname) => canAccessPath(user, pathname),
      defaultLandingPath: getDefaultLandingPath(user),
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
