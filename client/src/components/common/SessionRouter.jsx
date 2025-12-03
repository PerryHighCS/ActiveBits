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

    const { sessionId, activityName, hash, soloActivityId } = useParams(); // Check for regular, persistent, and solo routes

    const storageKey = `session-${sessionId}`;

    const [sessionData, setSessionData] = useState(null);
    const [persistentSessionInfo, setPersistentSessionInfo] = useState(null);
    const [isLoadingPersistent, setIsLoadingPersistent] = useState(false);
    const [teacherCode, setTeacherCode] = useState('');
    const [teacherAuthError, setTeacherAuthError] = useState('');
    const [isAuthenticatingTeacher, setIsAuthenticatingTeacher] = useState(false);

    const [error, setError] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (hash && activityName) {
            setTeacherCode('');
            setTeacherAuthError('');
            setIsAuthenticatingTeacher(false);
        }
    }, [hash, activityName]);

    useEffect(() => {
        if (!soloActivityId) {
            setSoloActivity(null);
            setError(null);
            return;
        }

        const activity = activities.find((act) => act.id === soloActivityId);
        if (!activity) {
            setSoloActivity(null);
            setError('Unknown solo activity');
            return;
        }

        if (!activity.soloMode) {
            setSoloActivity(null);
            setError('This activity does not support solo mode');
            return;
        }

        setError(null);
        setSoloActivity(activity);
    }, [soloActivityId]);

    useEffect(() => {
        cleanExpiredSessions();
    }, []);

    useEffect(() => setError(null), [sessionIdInput]);

    // Handle persistent session route
    useEffect(() => {
        if (hash && activityName) {
            setIsLoadingPersistent(true);
            setPersistentSessionInfo(null);
            fetch(`/api/persistent-session/${hash}?activityName=${activityName}`, { credentials: 'include' })
                .then(res => {
                    if (!res.ok) throw new Error('Persistent session not found');
                    return res.json();
                })
                .then(data => {
                    setPersistentSessionInfo(data);
                    setIsLoadingPersistent(false);
                })
                .catch(() => {
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
                    // Use replace to avoid back-navigation to waiting room
                    navigate(`/manage/${activityName}/${persistentSessionInfo.sessionId}`, { replace: true });
                    return <div className="text-center">Redirecting to session...</div>;
                } else if (isAuthenticatingTeacher) {
                    return (
                        <div className="text-center">
                            Verifying teacher code...
                        </div>
                    );
                } else {
                    const handleTeacherLogin = async (event) => {
                        event.preventDefault();
                        setTeacherAuthError('');
                        setIsAuthenticatingTeacher(true);
                        try {
                            const res = await fetch('/api/persistent-session/authenticate', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                credentials: 'include',
                                body: JSON.stringify({
                                    activityName,
                                    hash,
                                    teacherCode: teacherCode.trim(),
                                }),
                            });

                            if (!res.ok) {
                                const data = await res.json().catch(() => ({}));
                                throw new Error(data.error || 'Invalid teacher code');
                            }

                            const data = await res.json();
                            navigate(`/manage/${activityName}/${data.sessionId || persistentSessionInfo.sessionId}`, { replace: true });
                        } catch (err) {
                            setTeacherAuthError(err.message);
                            setIsAuthenticatingTeacher(false);
                        }
                    };

                    return (
                        <div className="max-w-lg mx-auto bg-white rounded-lg shadow-lg p-6 border border-gray-200">
                            <h1 className="text-2xl font-bold text-gray-800 mb-3 text-center">Session is already running</h1>
                            <p className="text-gray-700 text-center mb-6">
                                Enter your teacher code to open the manage dashboard, or join as a student instead.
                            </p>
                            <form onSubmit={handleTeacherLogin} className="space-y-4">
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-semibold text-gray-700">Teacher Code</label>
                                    <input
                                        type="password"
                                        value={teacherCode}
                                        onChange={(e) => setTeacherCode(e.target.value)}
                                        className="border-2 border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
                                        placeholder="Enter teacher code"
                                        autoComplete="off"
                                        required
                                    />
                                    {teacherAuthError && (
                                        <p className="text-sm text-red-600">{teacherAuthError}</p>
                                    )}
                                </div>
                                <div className="flex flex-col sm:flex-row gap-3 justify-between">
                                    <Button
                                        type="submit"
                                        disabled={!teacherCode.trim() || isAuthenticatingTeacher}
                                    >
                                        {isAuthenticatingTeacher ? 'Verifying...' : 'Go to Manage'}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        type="button"
                                        onClick={() => navigate(`/${persistentSessionInfo.sessionId}`, { replace: true })}
                                    >
                                        Join as Student
                                    </Button>
                                </div>
                            </form>
                        </div>
                    );
                }
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

        return (
            <WaitingRoom 
                activityName={activityName}
                hash={hash}
                hasTeacherCookie={persistentSessionInfo?.hasTeacherCookie ?? false}
            />
        );
    }
    
    // Solo mode - practice without a session
    if (soloActivity) {
        const StudentComponent = soloActivity.StudentComponent;
        return <StudentComponent sessionData={{ sessionId: `solo-${soloActivity.id}`, studentName: 'Solo Student' }} />;
    }
    
    if (!sessionId) {
        // Get all activities that support solo mode
        const soloActivities = activities.filter(activity => activity.soloMode);
        const colorClasses = {
            blue: 'bg-blue-600',
            green: 'bg-green-600',
            purple: 'bg-purple-600',
            red: 'bg-red-600',
            yellow: 'bg-yellow-600',
            indigo: 'bg-indigo-600',
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
                                    onClick={() => navigate(`/solo/${activity.id}`)}
                                    className="rounded-lg shadow-md overflow-hidden w-full max-w-md border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer"
                                >
                                    <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-3`}>
                                        <h3 className="text-xl font-semibold">{activity.name}</h3>
                                    </div>
                                    <div className={`${bgColorClasses[activity.color] || 'bg-gray-50'} px-6 py-4`}>
                                        <p className="text-gray-600">{activity.description}</p>
                                    </div>
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
