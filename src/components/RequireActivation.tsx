import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getActivationStatus, type ActivationStatusDto } from '../lib/api/activationApi';

let cachedActivationStatus: ActivationStatusDto | null = null;
let activationStatusRequest: Promise<ActivationStatusDto> | null = null;

function loadActivationStatusInBackground(force = false): Promise<ActivationStatusDto> {
  if (!force && activationStatusRequest) return activationStatusRequest;

  activationStatusRequest = getActivationStatus()
    .then((result) => {
      cachedActivationStatus = result;
      return result;
    })
    .finally(() => {
      activationStatusRequest = null;
    });

  return activationStatusRequest;
}

export const RequireActivation: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [status, setStatus] = useState<ActivationStatusDto | null>(cachedActivationStatus);

  useEffect(() => {
    let cancelled = false;

    loadActivationStatusInBackground()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((err) => {
        console.warn('[activation] background status check failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      loadActivationStatusInBackground(true)
        .then(setStatus)
        .catch((err) => console.warn('[activation] background refresh failed:', err));
    };

    window.addEventListener('clotex:activation-updated', refresh);
    return () => window.removeEventListener('clotex:activation-updated', refresh);
  }, []);

  if (status?.requireActive && !status.active && !location.pathname.startsWith('/settings')) {
    return <Navigate to="/settings?tab=activation" replace />;
  }

  return <>{children}</>;
};
