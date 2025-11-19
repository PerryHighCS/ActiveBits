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
            onClick={() => createSession(activity.id)}
            className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer"
          >
            <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-4`}>
              <h3 className="text-xl font-semibold">{activity.name}</h3>
            </div>
            <div className="bg-white px-6 py-4">
              <p className="text-gray-600">{activity.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
