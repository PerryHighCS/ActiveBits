import React from 'react';
import type { ReactNode } from 'react';
import Button from '@src/components/ui/Button.js';

interface ToggleLabels {
  notes: string;
  table: string;
}

interface ActionButtonItem {
  key: string;
  content: ReactNode;
}

function isActionItem(item: ReactNode | ActionButtonItem): item is ActionButtonItem {
  return typeof item === 'object' && item !== null && 'key' in item && 'content' in item;
}

function deriveActionKey(action: ReactNode | ActionButtonItem, index: number): string {
  if (isActionItem(action)) {
    return action.key;
  }
  if (React.isValidElement(action) && action.key != null) {
    return String(action.key);
  }
  return `action-${index}`;
}

function deriveActionContent(action: ReactNode | ActionButtonItem): ReactNode {
  return isActionItem(action) ? action.content : action;
}

interface FeedbackViewSwitcherProps {
  showNotesView: boolean;
  onToggleView: () => void;
  toggleButtonVariant?: 'default' | 'outline' | 'danger';
  toggleLabels?: ToggleLabels;
  actionsClassName?: string;
  actionButtons?: (ReactNode | ActionButtonItem)[];
  error?: string | null;
  isLoading?: boolean;
  loadingText?: string;
  tableView: ReactNode;
  notesView: ReactNode;
}

export default function FeedbackViewSwitcher({
  showNotesView,
  onToggleView,
  toggleButtonVariant = 'outline',
  toggleLabels = { notes: 'Notes view', table: 'Table view' },
  actionsClassName = '',
  actionButtons = [],
  error,
  isLoading = false,
  loadingText = 'Loading…',
  tableView,
  notesView,
}: FeedbackViewSwitcherProps): React.JSX.Element {
  const actionsClasses = ['flex flex-wrap items-center gap-3', actionsClassName].filter(Boolean).join(' ');
  return (
    <div className="space-y-4">
      <div className={actionsClasses}>
        <div className="me-auto">
          <Button
            type="button"
            variant={toggleButtonVariant}
            onClick={onToggleView}
          >
            {showNotesView ? toggleLabels.table : toggleLabels.notes}
          </Button>
        </div>
        {actionButtons.map((action, index) => (
          <div key={deriveActionKey(action, index)} className="flex items-center">
            {deriveActionContent(action)}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {isLoading ? (
        <p className="text-gray-600">{loadingText}</p>
      ) : (
        <>
          {!showNotesView && tableView}
          {showNotesView && notesView}
        </>
      )}
    </div>
  );
}
