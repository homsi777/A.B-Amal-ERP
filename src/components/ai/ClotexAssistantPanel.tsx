import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Loader2, MoreVertical, Send, Trash2, X } from 'lucide-react';
import {
  sendFabricChatMessage,
  type FabricChatMessage,
} from '../../lib/api/aiApi';

const WELCOME = 'مرحبا بعودتك انا CLOTEX';
const HELPER =
  'اسألني عن المخزون، الأقمشة، الزبائن، الحاويات، المبيعات، الدفعات، أو أي بيانات داخل مشروع الأقمشة.';

const SUGGESTED = [
  'كم إجمالي المخزون الحالي؟',
  'ما الأقمشة التي قاربت على النفاد؟',
  'اعرض ملخص آخر حاوية',
  'ما أكثر قماش مبيعاً هذا الشهر؟',
  'ما رصيد زبون معيّن؟',
];

const ERR_MISSING_KEY = 'لم يتم ضبط مفتاح OpenAI بعد. يرجى ضبطه من الإعدادات.';
const ERR_API = 'تعذر الحصول على رد الآن. حاول مرة أخرى.';
const ERR_SCOPE =
  'أنا CLOTEX، مساعد خاص بمشروع الأقمشة فقط، ولا أستطيع الإجابة خارج بيانات المشروع.';

type ChatRow = FabricChatMessage & { id: string; error?: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
};

function mapError(reply: string, errorCode: string | null): { text: string; isError: boolean } {
  if (errorCode === 'AI_NOT_CONFIGURED' || errorCode === 'AI_DISABLED') {
    return { text: ERR_MISSING_KEY, isError: true };
  }
  if (errorCode === 'AI_API_ERROR' || errorCode === 'AI_OPENAI_ERROR') {
    return { text: reply || ERR_API, isError: true };
  }
  if (reply.includes(ERR_SCOPE)) {
    return { text: ERR_SCOPE, isError: true };
  }
  return { text: reply, isError: false };
}

export function ClotexAssistantPanel({ open, onClose }: Props) {
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasUserMessages = messages.some((m) => m.role === 'user');
  const isEmpty = !hasUserMessages;

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setMenuOpen(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userRow: ChatRow = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
      const history: FabricChatMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userRow]);
      setInput('');
      setSending(true);

      try {
        const data = await sendFabricChatMessage({
          message: trimmed,
          history,
          sessionId,
        });
        if (data.sessionId) setSessionId(data.sessionId);
        const mapped = mapError(data.reply, data.errorCode);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: mapped.text,
            error: mapped.isError,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: ERR_API, error: true },
        ]);
      } finally {
        setSending(false);
      }
    },
    [messages, sending, sessionId],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  const panel = (
    <>
      <div
        className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px] md:bg-transparent md:backdrop-blur-none"
        onClick={onClose}
        aria-hidden
      />
      <section
        dir="rtl"
        role="dialog"
        aria-label="مساعد CLOTEX"
        className="fixed z-[201] flex flex-col overflow-hidden border border-[var(--border-default)] bg-[var(--surface-header)] shadow-2xl
          inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl
          md:inset-x-auto md:bottom-auto md:start-auto md:end-4 md:top-[4.5rem] md:h-[min(640px,calc(100vh-5.5rem))] md:w-[min(420px,calc(100vw-2rem))] md:rounded-2xl"
      >
        <header className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--text-heading)]">CLOTEX</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                متصل
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">مساعد مشروع الأقمشة</p>
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)]"
              aria-label="قائمة المحادثة"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute end-0 top-full z-10 mt-1 min-w-[10rem] rounded-lg border border-[var(--border-default)] bg-[var(--surface-header)] py-1 shadow-lg">
                <button
                  type="button"
                  onClick={clearChat}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-[var(--surface-muted-nav)]"
                >
                  <Trash2 className="h-4 w-4" />
                  مسح المحادثة
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)]"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {isEmpty && (
            <div className="space-y-3">
              <div className="max-w-[92%] rounded-2xl rounded-ee-md bg-[var(--surface-muted-nav)] px-3 py-2.5 text-sm text-[var(--text-heading)]">
                {WELCOME}
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">{HELPER}</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(chip)}
                    className="rounded-full border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-1.5 text-xs text-[var(--text-heading)] transition hover:border-[var(--ui-accent-border)] hover:bg-[var(--ui-accent-soft-bg)] disabled:opacity-60"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`group relative max-w-[88%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                  ${msg.role === 'user'
                    ? 'rounded-es-md bg-[var(--ui-accent)] text-white'
                    : msg.error
                      ? 'rounded-ee-md border border-red-200 bg-red-50 text-red-800'
                      : 'rounded-ee-md bg-[var(--surface-muted-nav)] text-[var(--text-heading)]'
                  }`}
              >
                {msg.content}
                {msg.role === 'assistant' && !msg.error && (
                  <button
                    type="button"
                    onClick={() => void copyText(msg.content)}
                    className="absolute -start-8 top-1 rounded p-1 text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--surface-muted-nav)]"
                    aria-label="نسخ الرد"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-end">
              <div className="flex items-center gap-2 rounded-2xl rounded-ee-md bg-[var(--surface-muted-nav)] px-3 py-2 text-xs text-[var(--text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                CLOTEX يراجع بيانات المشروع...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={onSubmit} className="border-t border-[var(--border-subtle)] p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="اكتب سؤالك عن بيانات المشروع..."
              disabled={sending}
              className="max-h-28 min-h-[42px] flex-1 resize-y rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2.5 text-sm text-[var(--text-heading)] outline-none focus:ring-2 focus:ring-[var(--ui-accent)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[var(--ui-accent)] text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="إرسال"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </section>
    </>
  );

  return createPortal(panel, document.body);
}
