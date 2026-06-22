import { useEffect } from 'react';
import { pingSessionPresence } from '../lib/api/authApi';

/** نبضة دورية لإبقاء جلسة المستخدم ظاهرة في «الأجهزة النشطة». */
export function SessionPresenceTracker() {
  useEffect(() => {
    const ping = () => {
      void pingSessionPresence().catch(() => {
        /* تجاهل — انقطاع مؤقت أو جلسة منتهية */
      });
    };
    ping();
    const timer = window.setInterval(ping, 45_000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
