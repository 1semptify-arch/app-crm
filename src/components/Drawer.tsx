import type { ReactNode } from 'react';
import { Icon } from './ui';

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-gray-900/30 sm:top-16"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-xl sm:top-16 sm:max-w-md"
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>
  );
}
