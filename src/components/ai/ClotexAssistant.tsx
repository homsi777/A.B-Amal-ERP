import React, { useCallback, useEffect, useState } from 'react';
import { getAiSettings } from '../../lib/api/aiApi';
import { ClotexAssistantButton } from './ClotexAssistantButton';
import { ClotexAssistantPanel } from './ClotexAssistantPanel';

export function ClotexAssistant() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    try {
      const settings = await getAiSettings();
      setEnabled(settings.enabled);
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    const onRefresh = () => refreshSettings();
    window.addEventListener('clotex-ai-settings-changed', onRefresh);
    return () => window.removeEventListener('clotex-ai-settings-changed', onRefresh);
  }, [refreshSettings]);

  if (loading || !enabled) return null;

  return (
    <>
      <ClotexAssistantButton open={open} onClick={() => setOpen((v) => !v)} />
      <ClotexAssistantPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
