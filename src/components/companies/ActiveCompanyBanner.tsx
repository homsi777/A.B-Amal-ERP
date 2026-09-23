import React, { useEffect, useRef, useState } from 'react';
import { fetchMe, type AuthUser } from '../../lib/api/authApi';

/** لون ثابت لكل حساب (نفس الحساب = نفس اللون دائماً)، من هاش بسيط على companyId. */
const PALETTE = [
  { bg: '#1d4ed8', fg: '#ffffff' }, // blue
  { bg: '#0f766e', fg: '#ffffff' }, // teal
  { bg: '#7c2d12', fg: '#ffffff' }, // brown
  { bg: '#6d28d9', fg: '#ffffff' }, // violet
  { bg: '#b91c1c', fg: '#ffffff' }, // red
  { bg: '#a16207', fg: '#ffffff' }, // amber-dark
  { bg: '#0369a1', fg: '#ffffff' }, // sky
  { bg: '#4d7c0f', fg: '#ffffff' }, // lime-dark
];

function colorForCompany(companyId: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < companyId.length; i++) {
    hash = (hash * 31 + companyId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * شريط علوي يظهر فقط لمدير المنصة، يوضّح أي حساب هو النشط الآن — مهم لأن
 * بشير يقدر يتبدّل بين حسابات، ولازم يعرف دائماً وبوضوح أي حساب يشتغل عليه
 * قبل ما يضيف/يعدّل أي بيانات. غير مرئي إطلاقاً لأي مستخدم عادي.
 */
export function ActiveCompanyBanner() {
  const [me, setMe] = useState<AuthUser | null>(null);
  const originalTitleRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((user) => {
        if (!cancelled) setMe(user);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    if (me?.isPlatformAdmin && me.companyCode) {
      document.title = `[${me.companyCode}] ${originalTitleRef.current}`;
    } else if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
    }
    return () => {
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
      }
    };
  }, [me?.isPlatformAdmin, me?.companyCode]);

  if (!me?.isPlatformAdmin) return null;

  const isOtherCompany = me.companyId !== me.homeCompanyId;
  const color = colorForCompany(me.companyId);

  return (
    <div
      className="w-full text-center text-xs font-bold py-1.5 px-3"
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      الحساب النشط: {me.companyName} ({me.companyCode})
      {isOtherCompany && <span className="mr-2">(حساب آخر)</span>}
    </div>
  );
}
