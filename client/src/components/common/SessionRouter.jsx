import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import WaitingRoom from './WaitingRoom';
import { getActivity, activities } from '../../activities';

const CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours in milliseconds

function cleanExpiredSessions() {
  const now = Date.now();
  for (const key in localStorage) {
    if (key.startsWith('session-')) {
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (!entry.timestamp || now - entry.timestamp >= CACHE_TTL) {
          localStorage.removeItem(key);
          console.log("Expiring " + key);
        }
      } catch {
        // If parsing fails, remove invalid entry
        localStorage.removeItem(key);
        console.log("Removing invalid entry " + key);
      }
    }
  }
}

/**
 * SessionRouter component allows users to enter a session ID to join an activity session.
 * When a session id is present in the URL, it will be used to fetch the session data
 * which will then be passed to the appropriate activity component.
 *
 * @returns {React.Component} The SessionRouter component.
 */
const SessionRouter = () => {
    const [sessionIdInput, setSessionIdInput] = useState('');
    const [soloActivity, setSoloActivity] = useState(null);

    const { sessionId, activityName, hash } = useParams(); // Check for both regular and persistent session params

    const storageKey = `session-${sessionId}`;

    const [sessionData, setSessionData] = useState(null);
    const [persistentSessionInfo, setPersistentSessionInfo] = useState(null);
    const [isLoadingPersistent, setIsLoadingPersistent] = useState(false);

    const [error, setError] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        cleanExpiredSessions();
    }, []);

    useEffect(() => setError(null), [sessionIdInput]);

    // Handle persistent session route
    useEffect(() => {
        if (hash && activityName) {
            setIsLoadingPersistent(true);
            fetch(`/api/persistent-session/${hash}?activityName=${activityName}`)
                .then(res => {
                    if (!res.ok) throw new Error('Persistent session not found');
                    return res.json();
                })
                .then(data => {
                    setPersistentSessionInfo(data);
                    setIsLoadingPersistent(false);
                })
                .catch(err => {
                    setError('Invalid persistent session link');
                    setIsLoadingPersistent(false);
                });
        }
    }, [hash, activityName]);

    useEffect(() => {
        if (!sessionId || sessionData) return; // Already cached

        const cached = localStorage.getItem(storageKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < CACHE_TTL) {
                    console.log('using cached data', parsed);
                    setSessionData(parsed);
                    return;
                } else {
                    localStorage.removeItem(`session-${sessionId}`);
                    console.log('removing ' + storageKey);
                }
            } catch {
                localStorage.removeItem(`session-${sessionId}`);
                console.log('removing invalid ' + storageKey);
            }
        }

        fetch(`/api/session/${sessionId}`)
        .then((res) => {
            if (!res.ok) throw new Error('Session not found');
            return res.json();
        })
        .then((data) => {
            const fullData = { ...data.session, sessionId, timestamp: Date.now() };
            localStorage.setItem(storageKey, JSON.stringify(fullData));
            setSessionData(fullData);
        })
        .catch(() => setError('Invalid or missing session'));
    }, [sessionId, sessionData, storageKey]);

    /**
     * Handle input change from the session ID input field.
     * @param {Event} e - The event object from the input change.
     */
    const handleInputChange = (e) => {
        setSessionIdInput(e.target.value.toLowerCase());
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (parseInt(sessionIdInput.trim(), 16)) {
            // Update the URL with the entered sessionId.
            navigate(`/${sessionIdInput.trim()}`);
        }
    };

    if (error) return <div className="text-red-500 text-center">{error}</div>;
    
    // Show waiting room for persistent sessions
    if (hash && activityName) {
        if (isLoadingPersistent) {
            return <div className="text-center">Loading...</div>;
        }
        
        if (persistentSessionInfo) {
            // If session already started, redirect appropriately
            if (persistentSessionInfo.isStarted && persistentSessionInfo.sessionId) {
                // If user has teacher cookie, redirect to manage page
                if (persistentSessionInfo.hasTeacherCookie) {
                    navigate(`/manage/${activityName}/${persistentSessionInfo.sessionId}`, { replace: true });
                } else {
                    // Student - redirect to session
                    navigate(`/${persistentSessionInfo.sessionId}`, { replace: true });
                }
                return <div className="text-center">Redirecting to session...</div>;
            }
            
            // Show waiting room
            return (
                <WaitingRoom 
                    activityName={activityName}
                    hash={hash}
                    hasTeacherCookie={persistentSessionInfo.hasTeacherCookie}
                />
            );
        }
    }
    
    // Solo mode - practice without a session
    if (soloActivity) {
        const StudentComponent = soloActivity.StudentComponent;
        return <StudentComponent sessionData={{ sessionId: `solo-${soloActivity.id}`, studentName: 'Solo Student' }} />;
    }
    
    if (!sessionId) {
        // Get all activities that support solo mode
        const soloActivities = activities.filter(activity => activity.soloMode);
        
        return (
            <div className="flex flex-col items-center gap-8 max-w-2xl mx-auto p-6">
                {/* Join Session Section */}
                <form onSubmit={handleSubmit} className='flex flex-col items-center w-max mx-auto'>
                    <label className='block mb-4'>
                        Join Session ID:
                        <input className='border border-grey-700 rounded mx-2 p-2' size='5' type="text" id='sessionId' value={sessionIdInput} onChange={handleInputChange} />
                    </label>
                    <Button type="submit">Join Session</Button>
                </form>

                {/* Solo Bits Section */}
                {soloActivities.length > 0 && (
                    <div className="w-full border-t-2 border-gray-300 pt-8">
                        <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">Solo Bits</h2>
                        <p className="text-center text-gray-600 mb-6">Practice on your own</p>
                        <div className="flex flex-col items-center gap-4">
                            {soloActivities.map(activity => (
                                <div 
                                    key={activity.id} 
                                    onClick={() => setSoloActivity(activity)}
                                    className="bg-white rounded-lg shadow-md p-6 w-full max-w-md border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer"
                                >
                                    <h3 className="text-xl font-semibold mb-2 text-gray-800">{activity.name}</h3>
                                    <p className="text-gray-600">{activity.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    if (!sessionData) return <div className="text-center">Loading session...</div>;
    console.log('session data', sessionData);

    // Get the activity configuration for this session type
    const activity = getActivity(sessionData.type);
    
    if (!activity) {
        return <div className="text-center">Unknown session type: {sessionData.type}</div>;
    }

    // Render the appropriate student component for this activity
    const StudentComponent = activity.StudentComponent;
    return <StudentComponent sessionData={sessionData} />;
};

export default SessionRouter;