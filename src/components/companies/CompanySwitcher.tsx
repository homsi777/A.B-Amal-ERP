import React, { useEffect, useState } from 'react';
import { Globe2, Loader2 } from 'lucide-react';
import { fetchMe, switchCompanyApi } from '../../lib/api/authApi';
import { listCompanies, type ApiCompany } from '../../lib/api/companiesApi';

/**
 * يظهر فقط لمدير المنصة (isPlatformAdmin) — يسمح له بمشاهدة/العمل ضمن أي
 * حساب من القائمة عبر إصدار توكن جديد بنفس هويته لكن بحساب مختلف.
 * غير مرئي إطلاقاً لأي مستخدم عادي (لا يستدعي حتى /api/companies بالنسبة له).
 */
export function CompanySwitcher() {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [companies, setCompanies] = useState<ApiCompany[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState('');
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (cancelled) return;
        setIsPlatformAdmin(me.isPlatformAdmin);
        setCurrentCompanyId(me.companyId);
        if (me.isPlatformAdmin) {
          void listCompanies()
            .then((rows) => { if (!cancelled) setCompanies(rows); })
            .catch(() => { if (!cancelled) setCompanies([]); });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isPlatformAdmin) return null;

  const handleChange = async (companyId: string) => {
    if (!companyId || companyId === currentCompanyId) return;
    setSwitching(true);
    try {
      await switchCompanyApi(companyId);
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  };

  return (
    <div className="hidden md:flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-2 py-1.5">
      <Globe2 className="w-4 h-4 text-[var(--ui-accent)] shrink-0" />
      {switching ? (
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
      ) : (
        <select
          value={currentCompanyId}
          onChange={(e) => void handleChange(e.target.value)}
          className="bg-transparent text-xs font-bold text-[var(--text-heading)] outline-none"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
