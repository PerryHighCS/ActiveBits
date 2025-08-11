// ManageDashboard.jsx
import { useNavigate } from 'react-router-dom';

export default function ManageDashboard() {
  const navigate = useNavigate();

  const createSession = async (type) => {
    try {
      const res = await fetch(`/api/${type}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('Failed to create session');

      const data = await res.json();
      navigate(`/manage/${type}/${data.id}`);
    } catch (err) {
      console.error(err);
      alert('Could not create session.');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Activity Dashboard</h1>
      <div className="space-x-4">
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={() => createSession('raffle')}
        >
          Create Raffle
        </button>

        <button
          className="bg-green-600 text-white px-4 py-2 rounded"
          onClick={() => createSession('www-sim')}
        >
          Create WWW Simulation
        </button>
      </div>
    </div>
  );
}
