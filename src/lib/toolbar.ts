// State-to-toolbar engine — TypeScript port of tools/smart_toolbar.py.
// The same contract the fleet Python engine enforces: given the entity's
// real state, project ONE primary action, up to `maxVisible` contextual
// actions, and push the rest into overflow. Actions that cannot run in
// the current state are never produced — so no disabled buttons ever
// render (busy-locks and form-validation disables are a different,
// legitimate class and stay).

import type { IconName } from '../components/ui';

export interface ToolbarAction {
  /** Stable id for React keys. */
  key: string;
  label: string;
  /** 'primary' = the one next right action; 'ghost' = contextual. */
  kind: 'primary' | 'ghost';
  /** Danger styling (destructive: delete, decline). */
  danger?: boolean;
  /** Navigation action. Render <a>; otherwise render <button> calling run. */
  href?: string;
  run?: () => void;
  /** Extra classes merged onto the base class. */
  className?: string;
  icon?: IconName;
}

export interface ProjectedToolbar {
  /** The single next right action, or null when nothing applies. */
  primary: ToolbarAction | null;
  /** Visible contextual actions (max `maxVisible`). */
  visible: ToolbarAction[];
  /** Everything else — render behind a disclosure control. */
  overflow: ToolbarAction[];
}

/**
 * Project a candidate list into the toolbar contract. `candidates` is the
 * output of a state rule map — already filtered to actions valid in the
 * current state, in priority order. The first 'primary'-kind action wins
 * the primary slot; a second 'primary' demotes to contextual (a state map
 * bug surfaces as a visible choice, never a hidden one).
 */
export function projectToolbar(
  candidates: ToolbarAction[],
  maxVisible = 3,
): ProjectedToolbar {
  let primary: ToolbarAction | null = null;
  const rest: ToolbarAction[] = [];
  for (const a of candidates) {
    if (a.kind === 'primary' && primary === null) {
      primary = a;
    } else {
      rest.push(a);
    }
  }
  return {
    primary,
    visible: rest.slice(0, maxVisible),
    overflow: rest.slice(maxVisible),
  };
}

/** Shared classes so every smart toolbar in the app looks identical. */
export const TOOLBAR_ACTION_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 text-sm font-medium text-gray-700 hover:bg-gray-50';
export const TOOLBAR_PRIMARY_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white hover:bg-indigo-700';
export const TOOLBAR_DANGER_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-200 px-3.5 text-sm font-medium text-red-700 hover:bg-red-50';
