// ManageDashboard.jsx
import { useNavigate } from 'react-router-dom';
import { activities } from '../../activities';

export default function ManageDashboard() {
  const navigate = useNavigate();

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

  // Map color names to Tailwind classes (Tailwind requires static class names)
  const colorClasses = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    green: 'bg-green-600 hover:bg-green-700',
    purple: 'bg-purple-600 hover:bg-purple-700',
    red: 'bg-red-600 hover:bg-red-700',
    yellow: 'bg-yellow-600 hover:bg-yellow-700',
    indigo: 'bg-indigo-600 hover:bg-indigo-700',
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Activity Dashboard</h1>
      <div className="space-x-4">
        {activities.map((activity) => (
          <button
            key={activity.id}
            className={`${colorClasses[activity.buttonColor] || 'bg-gray-600 hover:bg-gray-700'} text-white px-4 py-2 rounded transition-colors`}
            onClick={() => createSession(activity.id)}
            title={activity.description}
          >
            Create {activity.name}
          </button>
        ))}
      </div>
    </div>
  );
}
