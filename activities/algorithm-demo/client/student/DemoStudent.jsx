import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import AlgorithmPicker from '../components/AlgorithmPicker';
import { getAllAlgorithms, getAlgorithm } from '../algorithms';
import { MESSAGE_TYPES, normalizeAlgorithmState } from '../utils';
import './DemoStudent.css';

export default function DemoStudent({ sessionData, persistentSessionInfo }) {
  const { sessionId } = sessionData;
  const [searchParams] = useSearchParams();
  const attachSessionEndedHandler = useSessionEndedHandler();

  const [algorithms] = useState(getAllAlgorithms());
  const [selectedAlgoId, setSelectedAlgoId] = useState(null);
  const [algorithmState, setAlgorithmState] = useState(null);
  const [isSoloMode, setIsSoloMode] = useState(sessionId.startsWith('solo-'));
  const [isAutoSelectedFromParam, setIsAutoSelectedFromParam] = useState(false);

  // Auto-select algorithm from query params (persistentSessionInfo for shared, URL params for solo)
  useEffect(() => {
    // Check persistentSessionInfo first (for shared sessions)
    const algorithmParam = persistentSessionInfo?.queryParams?.algorithm || searchParams.get('algorithm');
    if (!algorithmParam || selectedAlgoId) return;
    
    const algo = getAlgorithm(algorithmParam);
    if (algo) {
      console.log(`[algorithm-demo] Auto-detected algorithm from query params: ${algorithmParam}`);
      // In solo mode, auto-select the algorithm
      if (isSoloMode) {
        setSelectedAlgoId(algorithmParam);
        const newState = algo.initState ? algo.initState() : {};
        setAlgorithmState(newState);
        setIsAutoSelectedFromParam(true);
      }
      // In shared mode, algorithm will be set by the manager or WebSocket message
    } else {
      console.warn(`[algorithm-demo] Algorithm "${algorithmParam}" specified in URL but not found in available algorithms`);
    }
  }, [persistentSessionInfo, searchParams, selectedAlgoId, isSoloMode]);

  // Sync initial session state and poll for updates
  useEffect(() => {
    if (!sessionId || isSoloMode) return;

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/algorithm-demo/${sessionId}/session`);
        if (res.ok) {
          const data = await res.json();
          if (data.data.algorithmId) {
            setSelectedAlgoId(data.data.algorithmId);
            setAlgorithmState(normalizeAlgorithmState(data.data.algorithmState) || null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch session:', err);
      }
    };

    // Fetch immediately on mount
    fetchSession();

    // Poll periodically to catch updates in case of WebSocket delays
    const pollInterval = setInterval(fetchSession, 3000);

    return () => clearInterval(pollInterval);
  }, [sessionId, isSoloMode]);

  // WebSocket for shared mode
  const buildWsUrl = useCallback(() => {
    if (!sessionId || isSoloMode) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/algorithm-demo?sessionId=${sessionId}`;
  }, [sessionId, isSoloMode]);

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: !isSoloMode,
    attachSessionEndedHandler,
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === MESSAGE_TYPES.ALGORITHM_SELECTED) {
          setSelectedAlgoId(msg.algorithmId);
          setAlgorithmState(normalizeAlgorithmState(msg.payload));
        } else if (msg.type === MESSAGE_TYPES.STATE_SYNC) {
          setAlgorithmState(normalizeAlgorithmState(msg.payload));
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    },
  });

  useEffect(() => {
    if (isSoloMode) return;
    connect();
    return () => disconnect();
  }, [sessionId, isSoloMode, connect, disconnect]);

  // Solo mode: handle local algorithm selection
  const handleSelectAlgorithm = (algoId) => {
    if (!isSoloMode) return; // In shared mode, manager controls selection

    setSelectedAlgoId(algoId);
    const algo = getAlgorithm(algoId);
    if (algo && algo.initState) {
      setAlgorithmState(algo.initState());
    }
  };

  // Solo mode: handle local state changes
  const handleStateChange = (newState) => {
    if (!isSoloMode) return; // In shared mode, students don't change state

    setAlgorithmState(newState);

    // Optionally persist solo progress to localStorage
    if (sessionId && sessionId.startsWith('solo-')) {
      localStorage.setItem(
        `algorithm-demo-solo-${sessionId}`,
        JSON.stringify({
          algorithmId: selectedAlgoId,
          algorithmState: newState,
          timestamp: Date.now(),
        })
      );
    }
  };

  const currentAlgo = getAlgorithm(selectedAlgoId);

  if (isSoloMode && !selectedAlgoId) {
    // Solo mode: show algorithm picker
    return (
      <div className="demo-student solo-mode">
        <h1>Algorithm Practice</h1>
        <p>Choose an algorithm to explore</p>
        <AlgorithmPicker
          algorithms={algorithms}
          selectedId={selectedAlgoId}
          onSelect={handleSelectAlgorithm}
          title="Select Algorithm"
        />
      </div>
    );
  }

  if (!currentAlgo) {
    return <div className="error">Waiting for instructor to select an algorithm...</div>;
  }

  const CurrentStudentView = currentAlgo.StudentView;

  return (
    <div className="demo-student">
      {isSoloMode && !isAutoSelectedFromParam ? (
        <div className="solo-header">
          <h2>{currentAlgo.name}</h2>
          <button
            onClick={() => setSelectedAlgoId(null)}
            className="btn-switch"
          >
            Switch Algorithm
          </button>
        </div>
      ) : isSoloMode ? (
        <div className="solo-header">
          <h2>{currentAlgo.name}</h2>
        </div>
      ) : (
        <div className="shared-header">
          <h2>Now Demonstrating: {currentAlgo.name}</h2>
        </div>
      )}

      {algorithmState && (
        <div className="student-view">
          <CurrentStudentView
            session={{
              id: sessionId,
              data: { algorithmState, algorithmId: selectedAlgoId },
            }}
            onStateChange={isSoloMode ? handleStateChange : undefined}
          />
        </div>
      )}
    </div>
  );
}
