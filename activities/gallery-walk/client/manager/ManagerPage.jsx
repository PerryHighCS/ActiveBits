import React from 'react';
import { Link, useParams } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';

export default function ManagerPage() {
  const { sessionId } = useParams();

  return (
    <div className="p-6">
      <SessionHeader activityName="Gallery Walk" sessionId={sessionId || 'unknown'} />
      {!sessionId ? (
        <div className="mt-6 text-gray-600 space-y-2">
          <p>No session selected. Start a Gallery Walk from the dashboard to get a join code.</p>
          <Link to="/manage" className="text-blue-600 underline">
            Back to dashboard
          </Link>
        </div>
      ) : (
        <div className="mt-6 text-gray-600">
          Gallery Walk teacher dashboard is under construction. This stub prevents runtime errors while
          the full manager experience is implemented.
        </div>
      )}
    </div>
  );
}
