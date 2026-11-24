import type { ReactNode } from 'react';
import type { ApptStatus, InteractionType, MatterStage } from '../types';

export const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-900 placeholder-gray-400 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 min-h-[44px]';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {children}
    </button>
  );
}

export function statusText(status: ApptStatus): { text: string; className: string } {
  switch (status) {
    case 'completed':
      return { text: 'Completed', className: 'text-green-600' };
    case 'canceled':
      return { text: 'Canceled', className: 'text-gray-400 line-through' };
    default:
      return { text: 'Scheduled', className: 'text-indigo-600' };
  }
}

export function typeLabel(type: InteractionType): string {
  return type === 'call' ? 'Call' : type === 'email' ? 'Email' : 'Note';
}

export function matterStageText(stage: MatterStage): { text: string; className: string } {
  switch (stage) {
    case 'active':
      return { text: 'Active', className: 'text-green-600' };
    case 'intake':
      return { text: 'Intake', className: 'text-amber-600' };
    case 'waiting':
      return { text: 'Waiting', className: 'text-amber-600' };
    case 'resolved':
      return { text: 'Resolved', className: 'text-gray-400' };
    case 'closed':
      return { text: 'Closed', className: 'text-gray-400 line-through' };
    default:
      return { text: 'New', className: 'text-indigo-600' };
  }
}

export type IconName =
  | 'sun'
  | 'calendar'
  | 'clock'
  | 'users'
  | 'inbox'
  | 'search'
  | 'plus'
  | 'x'
  | 'phone'
  | 'mail'
  | 'check'
  | 'pencil'
  | 'chevron-left'
  | 'chevron-right'
  | 'note'
  | 'trash'
  | 'briefcase'
  | 'download'
  | 'send'
  | 'folder'
  | 'file';

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5V5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10.5h18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M16.5 14.7c2.6.3 4.4 2 5 5.3" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 4h16a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" />
        <path d="M3 13h5l1.5 2.5h5L16 13h5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.5-4.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    phone: (
      <path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </>
    ),
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    pencil: (
      <>
        <path d="M4 20l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1z" />
        <path d="M13.5 6.5l4 4" />
      </>
    ),
    'chevron-left': <path d="M14.5 5.5L8 12l6.5 6.5" />,
    'chevron-right': <path d="M9.5 5.5L16 12l-6.5 6.5" />,
    note: (
      <>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M15 4v4h4M8.5 12h7M8.5 15.5h5" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12.5h18" />
      </>
    ),
    download: <path d="M12 4v11m0 0l-4-4m4 4l4-4M4 20h16" />,
    send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
    folder: (
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    ),
    file: (
      <path d="M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v4h4" />
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
