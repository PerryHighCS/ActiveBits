import React from 'react';
import Button from '@src/components/ui/Button';

export default function FeedbackViewSwitcher({
  showNotesView,
  onToggleView,
  toggleButtonVariant = 'outline',
  toggleLabels = { notes: 'Notes view', table: 'Table view' },
  actionsClassName = '',
  actionButtons = [],
  error,
  isLoading,
  loadingText = 'Loading…',
  tableView,
  notesView,
}) {
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
          <div key={`action-${index}`} className="flex items-center">
            {action}
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
