import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, X } from 'lucide-react';
import {
  createPreparationType,
  updatePreparationType,
  type PreparationType,
} from '../../lib/api/externalJobsApi';
import { useToast } from '../NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';

export const PreparationTypesModal = ({
  types,
  onClose,
  onChanged,
}: {
  types: PreparationType[];
  onClose: () => void;
  onChanged: () => void;
}) => {
  const { t } = useTranslation('externalJobs');
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [wastePct, setWastePct] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!name.trim()) {
      showToast({ type: 'error', message: t('processingNew.prepTypeNameRequired') });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updatePreparationType(editingId, {
          name: name.trim(),
          defaultWastePct: wastePct.trim() ? Number(wastePct) : null,
        });
      } else {
        await createPreparationType({
          name: name.trim(),
          defaultWastePct: wastePct.trim() ? Number(wastePct) : null,
        });
      }
      setName('');
      setWastePct('');
      setEditingId(null);
      onChanged();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('processingNew.prepTypeSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: PreparationType) => {
    setEditingId(p.id);
    setName(p.name);
    setWastePct(p.default_waste_pct != null ? String(p.default_waste_pct) : '');
  };

  const toggleActive = async (p: PreparationType) => {
    try {
      await updatePreparationType(p.id, { isActive: !p.is_active });
      onChanged();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('processingNew.prepTypeSaveFailed') });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">{t('processingNew.managePrepTypesTitle')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('processingNew.prepTypeNamePlaceholder')}
              className="flex-1 p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={wastePct}
              onChange={(e) => setWastePct(e.target.value)}
              placeholder={t('processingNew.prepTypeWastePlaceholder')}
              className="w-28 p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              dir="ltr"
            />
            <button
              onClick={() => void handleAdd()}
              disabled={saving}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
            >
              {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {types.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-400 text-center">{t('processingNew.noPrepTypesYet')}</p>
            ) : types.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={p.is_active ? 'font-medium text-slate-800' : 'text-slate-400 line-through'}>{p.name}</span>
                  {p.default_waste_pct != null && (
                    <span className="text-xs text-slate-400">({p.default_waste_pct}%)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-emerald-600"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => void toggleActive(p)} className="text-xs font-bold text-slate-500 hover:text-rose-600">
                    {p.is_active ? t('processingNew.deactivate') : t('processingNew.activate')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
