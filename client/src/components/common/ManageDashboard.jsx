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

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Activity Dashboard</h1>
      <div className="space-x-4">
        {activities.map((activity) => (
          <button
            key={activity.id}
            className={`bg-${activity.buttonColor}-600 text-white px-4 py-2 rounded`}
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
