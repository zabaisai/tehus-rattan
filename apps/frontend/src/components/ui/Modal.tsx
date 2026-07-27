'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const MAX_WIDTH_CLASSES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
} as const;

export type ModalMaxWidth = keyof typeof MAX_WIDTH_CLASSES;

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra actions rendered next to the close button (e.g. "Iniciar soporte"). */
  headerActions?: React.ReactNode;
  maxWidth?: ModalMaxWidth;
  /** Higher stacking context for modals opened from within another modal. */
  stackedZIndex?: boolean;
  /** Hide the close (X) button — used for flows that force an explicit action first. */
  hideCloseButton?: boolean;
  contentClassName?: string;
  /** Pinned below the scrollable body (e.g. pagination controls) — not part of the scroll area. */
  footer?: React.ReactNode;
}

/**
 * Shared modal shell used across the app. Desktop: centered card. Mobile
 * (<640px): near full-screen sheet with sticky header so actions at the
 * bottom of long forms stay reachable without losing the title/close button.
 */
export function Modal({
  title,
  onClose,
  children,
  headerActions,
  maxWidth = 'sm',
  stackedZIndex = false,
  hideCloseButton = false,
  contentClassName = '',
  footer,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className={`fixed inset-0 ${stackedZIndex ? 'z-[60]' : 'z-50'} flex items-end justify-center bg-black/30 sm:items-center sm:p-4`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-lg outline-none sm:max-h-[85vh] sm:rounded-lg ${MAX_WIDTH_CLASSES[maxWidth]}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-100 px-4 py-4 sm:border-0 sm:px-5 sm:pb-0 sm:pt-5">
          <h3 id={titleId} className="min-w-0 truncate text-sm font-semibold text-stone-900">
            {title}
          </h3>
          <div className="flex shrink-0 items-center gap-3">
            {headerActions}
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:p-5 ${contentClassName}`}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-stone-100 px-4 py-3 sm:px-5">{footer}</div>
        )}
      </div>
    </div>
  );
}
