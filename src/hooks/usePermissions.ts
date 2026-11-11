import { useEffect, useState } from 'react';
import { fetchMe, type AuthUser } from '../lib/api/authApi';

export function usePermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void fetchMe()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  function has(code: string): boolean {
    if (!user) return false;
    return user.role === 'admin' || user.permissions.includes(code);
  }

  return { user, has };
}
