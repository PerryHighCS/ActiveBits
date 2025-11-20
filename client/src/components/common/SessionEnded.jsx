import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';

/**
 * SessionEnded - Displayed when a session has been ended by the teacher
 */
export default function SessionEnded() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <svg 
              className="w-10 h-10 text-gray-600" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" 
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Session Ended
          </h1>
          <p className="text-gray-600">
            This session has been ended by your teacher.
          </p>
        </div>
        
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Thank you for participating!
          </p>
          
          <Button 
            onClick={() => navigate('/')}
            className="w-full"
          >
            Return to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
