import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessPath, defaultLandingPath } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p className="p-8 text-center text-[var(--text-muted)]">جاري التحقق من الصلاحيات…</p>;
  }

  if (!user) return <>{children}</>;

  if (!canAccessPath(location.pathname)) {
    return <Navigate to={defaultLandingPath} replace />;
  }

  return <>{children}</>;
}
