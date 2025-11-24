import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { activities } from '../../activities';
import { arrayToCsv, downloadCsv } from '../../utils/csvUtils';
import { useClipboard } from '../../hooks/useClipboard';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

export default function ManageDashboard() {
  const navigate = useNavigate();
  const [showPersistentModal, setShowPersistentModal] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [teacherCode, setTeacherCode] = useState('');
  const [persistentUrl, setPersistentUrl] = useState(null);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [persistentSessions, setPersistentSessions] = useState([]);
  const [savedSessions, setSavedSessions] = useState({});
  const [visibleCodes, setVisibleCodes] = useState({}); // Track which codes are visible
  const { copyToClipboard, isCopied } = useClipboard();
  const [sessionError, setSessionError] = useState(null);

  // Fetch teacher's persistent sessions on mount
  useEffect(() => {
    fetch('/api/persistent-session/list')
      .then(res => res.json())
      .then(data => {
        const sessions = data.sessions || [];
        setPersistentSessions(sessions);
        
        // Build savedSessions map from API response (includes teacher codes)
        const sessionsMap = {};
        sessions.forEach(session => {
          const key = `${session.activityName}:${session.hash}`;
          sessionsMap[key] = session.teacherCode;
        });
        setSavedSessions(sessionsMap);
      })
      .catch(err => {
        console.error('Failed to fetch persistent sessions:', err);
        setSavedSessions({});
      });
  }, []);

  const createSession = async (activityId) => {
    setSessionError(null);
    try {
      const res = await fetch(`/api/${activityId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('Failed to create session');

      const data = await res.json();
      navigate(`/manage/${activityId}/${data.id}`);
    } catch (err) {
      console.error(err);
      setSessionError('Could not create session. Please try again.');
      setTimeout(() => setSessionError(null), 5000);
    }
  };

  const openPersistentModal = (activity) => {
    setSelectedActivity(activity);
    setShowPersistentModal(true);
    setTeacherCode('');
    setPersistentUrl(null);
    setError(null);
  };

  const closePersistentModal = () => {
    setShowPersistentModal(false);
    setSelectedActivity(null);
    setTeacherCode('');
    setPersistentUrl(null);
    setError(null);
    setIsCreating(false);
  };

  const createPersistentLink = async (e) => {
    e.preventDefault();
    setError(null);
    setIsCreating(true);

    try {
      const res = await fetch('/api/persistent-session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityName: selectedActivity.id,
          teacherCode: teacherCode.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create persistent link');
      }

      const data = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      setPersistentUrl(fullUrl);
      
      // Update savedSessions with the new teacher code
      setSavedSessions(prev => ({
        ...prev,
        [`${selectedActivity.id}:${data.hash}`]: teacherCode.trim()
      }));
      
      // Refresh the list of persistent sessions
      fetch('/api/persistent-session/list')
        .then(res => res.json())
        .then(data => setPersistentSessions(data.sessions || []))
        .catch(err => console.error('Failed to refresh persistent sessions:', err));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const downloadPersistentLinksCSV = () => {
    const headers = ['Activity', 'Teacher Code', 'URL'];
    const rows = persistentSessions.map(session => [
      getActivityName(session.activityName),
      savedSessions[`${session.activityName}:${session.hash}`] || '',
      session.fullUrl
    ]);
    
    const csvContent = arrayToCsv([headers, ...rows]);
    downloadCsv(csvContent, 'permanent-links');
  };

  const toggleCodeVisibility = (sessionKey) => {
    setVisibleCodes(prev => ({
      ...prev,
      [sessionKey]: !prev[sessionKey]
    }));
  };

  // Get activity name from activity ID
  const getActivityName = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    return activity ? activity.name : activityId;
  };

  // Get activity color from activity ID
  const getActivityColor = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    return activity ? activity.color : 'blue';
  };

  // Map color names to Tailwind classes (Tailwind requires static class names)
  const colorClasses = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    purple: 'bg-purple-600',
    red: 'bg-red-600',
    yellow: 'bg-yellow-600',
    indigo: 'bg-indigo-600',
  };

  const borderColorClasses = {
    blue: 'border-blue-200',
    green: 'border-green-200',
    purple: 'border-purple-200',
    red: 'border-red-200',
    yellow: 'border-yellow-200',
    indigo: 'border-indigo-200',
  };

  const bgColorClasses = {
    blue: 'bg-blue-50',
    green: 'bg-green-50',
    purple: 'bg-purple-50',
    red: 'bg-red-50',
    yellow: 'bg-yellow-50',
    indigo: 'bg-indigo-50',
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {sessionError && (
        <div className="mb-4 bg-red-50 border-2 border-red-200 rounded p-3">
          <p className="text-red-700 font-semibold">{sessionError}</p>
        </div>
      )}
      
      <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">Activity Dashboard</h1>
      <p className="text-center text-gray-600 mb-8">Choose an activity to start a new session</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all flex flex-col h-full"
          >
            <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-4`}>
              <h3 className="text-xl font-semibold">{activity.name}</h3>
            </div>
            <div className={`${bgColorClasses[activity.color] || 'bg-gray-50'} px-6 py-4 flex flex-col h-full`}>
              <p className="text-gray-600 mb-4">{activity.description}</p>
              <div className="flex-1" />
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => createSession(activity.id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
                >
                  Start Session Now
                </button>
                <button
                  onClick={() => openPersistentModal(activity)}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded transition-colors"
                >
                  Create Permanent Link
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Persistent Sessions Section */}
      {persistentSessions.length > 0 && (
        <div className="mt-8 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-semibold text-gray-800">Your Permanent Links</h2>
            <Button onClick={downloadPersistentLinksCSV} variant="outline" className="text-sm">
              Download CSV
            </Button>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            These links are stored in your browser cookies. If you clear cookies or use a different browser, you'll need to save these URLs elsewhere.
          </p>
          <div className="space-y-2">
            {persistentSessions.map((session, idx) => {
              const color = getActivityColor(session.activityName);
              const bgClass = bgColorClasses[color] || 'bg-blue-50';
              const borderClass = borderColorClasses[color] || 'border-blue-200';
              const sessionKey = `${session.activityName}:${session.hash}`;
              const teacherCode = savedSessions[sessionKey];
              const isVisible = visibleCodes[sessionKey];
              
              return (
                <div key={idx} className={`flex items-center gap-2 ${bgClass} p-3 rounded border-2 ${borderClass}`}>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-700">{getActivityName(session.activityName)}</p>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Teacher Code:</span>
                      <code className="bg-white px-2 py-1 rounded">
                        {teacherCode ? (isVisible ? teacherCode : '•••••••') : '•••••'}
                      </code>
                      {teacherCode && (
                        <button
                          onClick={() => toggleCodeVisibility(sessionKey)}
                          className="text-blue-600 hover:text-blue-800 underline text-xs"
                          title={isVisible ? 'Hide code' : 'Show code'}
                        >
                          {isVisible ? 'hide' : 'show'}
                        </button>
                      )}
                    </div>
                  </div>
                  <Button 
                    onClick={() => copyToClipboard(session.fullUrl)}
                    variant="outline"
                    className="whitespace-nowrap"
                  >
                    {isCopied(session.fullUrl) ? '✓ Copied URL' : 'Copy URL'}
                  </Button>
                  <Button 
                    onClick={() => window.open(session.fullUrl, '_blank')}
                    variant="outline"
                  >
                    Open
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal 
        open={showPersistentModal} 
        onClose={closePersistentModal}
        title={`Create Permanent Link - ${selectedActivity?.name}`}
      >
        {!persistentUrl ? (
          <form onSubmit={createPersistentLink} className="flex flex-col gap-4">
            <p className="text-gray-700">
              Create a permanent URL that you can use in presentations or bookmark. 
              When anyone visits this URL, they'll wait until you start the session with your teacher code.
            </p>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Security Note:</strong> This is for convenience, not security. The teacher code is stored in your browser cookies and is not encrypted. Do not use sensitive passwords.
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Teacher Code (min. 6 characters)
              </label>
              <input
                type="text"
                value={teacherCode}
                onChange={(e) => setTeacherCode(e.target.value)}
                className="border-2 border-gray-300 rounded px-4 py-2 w-full focus:outline-none focus:border-blue-500"
                placeholder="Create a Teacher Code for this link"
                minLength={6}
                required
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 mt-1">
                Remember this code! You'll need it to start sessions from this link.
              </p>
            </div>

            {error && (
              <p className="text-red-600 text-sm bg-red-50 p-2 rounded">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isCreating || teacherCode.length < 6}>
              {isCreating ? 'Creating...' : 'Generate Link'}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-green-600 font-semibold">
              ✓ Permanent link created successfully!
            </p>
            
            <div className="bg-gray-50 p-4 rounded border-2 border-gray-200">
              <p className="text-sm text-gray-600 mb-2 font-semibold">Your permanent URL:</p>
              <code className="text-sm break-all bg-white p-2 rounded border border-gray-300 block">
                {persistentUrl}
              </code>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => copyToClipboard(persistentUrl)}>
                {isCopied(persistentUrl) ? '✓ Copied!' : 'Copy to Clipboard'}
              </Button>
              <button
                onClick={() => window.open(persistentUrl, '_blank')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded transition-colors"
              >
                Open in New Tab
              </button>
            </div>

            <p className="text-sm text-gray-600">
              Save this URL! Anyone who visits it will wait for you to start the session with your teacher code.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
