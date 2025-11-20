// ManageDashboard.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activities } from '../../activities';
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

  const createSession = async (activityId) => {
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
      alert('Could not create session.');
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
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(persistentUrl);
    alert('URL copied to clipboard!');
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">Activity Dashboard</h1>
      <p className="text-center text-gray-600 mb-8">Choose an activity to start a new session</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all"
          >
            <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-4`}>
              <h3 className="text-xl font-semibold">{activity.name}</h3>
            </div>
            <div className="bg-white px-6 py-4">
              <p className="text-gray-600 mb-4">{activity.description}</p>
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
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Teacher Code (min. 6 characters)
              </label>
              <input
                type="password"
                value={teacherCode}
                onChange={(e) => setTeacherCode(e.target.value)}
                className="border-2 border-gray-300 rounded px-4 py-2 w-full focus:outline-none focus:border-blue-500"
                placeholder="Enter a secure code"
                minLength={6}
                required
                autoComplete="new-password"
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
              <Button onClick={copyToClipboard}>
                Copy to Clipboard
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
