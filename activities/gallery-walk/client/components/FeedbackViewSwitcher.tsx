import React from 'react';
import type { ReactNode } from 'react';
import Button from '@src/components/ui/Button';

interface ToggleLabels {
  notes: string;
  table: string;
}

interface ActionButtonItem {
  key: string;
  content: ReactNode;
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
        {actionButtons.map((action, index) => {
          const isActionItem = (item: ReactNode | ActionButtonItem): item is ActionButtonItem =>
            typeof item === 'object' && item !== null && 'key' in item && 'content' in item;
          
          const key = isActionItem(action) ? action.key : 
            (React.isValidElement(action) && action.key != null ? String(action.key) : `action-${index}`);
          const content = isActionItem(action) ? action.content : action;
          
          return (
            <div key={key} className="flex items-center">
              {content}
            </div>
          );
        })}
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
