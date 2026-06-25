import React from 'react';
import { Loader2, MessageCircle } from 'lucide-react';

type TelegramSendButtonSize = 'toolbar' | 'compact';

export interface TelegramSendButtonProps {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  size?: TelegramSendButtonSize;
  label?: string;
  className?: string;
}

const sizeClasses: Record<TelegramSendButtonSize, string> = {
  toolbar: 'px-4 py-2 text-sm gap-2',
  compact: 'px-2 py-1 text-xs gap-1',
};

export function TelegramSendButton({
  onClick,
  disabled,
  busy,
  size = 'compact',
  label = 'تيليغرام',
  className = '',
}: TelegramSendButtonProps) {
  const iconClass = size === 'toolbar' ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => void onClick()}
      title="إرسال تيليغرام"
      className={`bg-sky-600 text-white rounded-lg inline-flex items-center hover:bg-sky-700 transition font-medium disabled:opacity-50 shadow-sm ${sizeClasses[size]} ${className}`}
    >
      {busy ? <Loader2 className={`${iconClass} animate-spin shrink-0`} /> : <MessageCircle className={`${iconClass} shrink-0`} />}
      <span>{busy ? 'جاري الإرسال…' : label}</span>
    </button>
  );
}
