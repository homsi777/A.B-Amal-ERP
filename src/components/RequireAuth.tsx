import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getStoredToken } from '../lib/api/client';

/**
 * Route guard.
 *
 *  - If no auth token is present in the runtime storage, redirect to /login.
 *  - In Electron, tokens live in sessionStorage and are wiped when the
 *    BrowserWindow is destroyed, so every fresh app launch lands on /login.
 *  - The original target path is forwarded as ?redirect= so the login page
 *    can send the user back to where they were after a successful sign-in.
 */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = getStoredToken();
  const location = useLocation();

  if (!token) {
    const here = `${location.pathname}${location.search}${location.hash}`;
    const target = here && here !== '/' ? `/login?redirect=${encodeURIComponent(here)}` : '/login';
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};
