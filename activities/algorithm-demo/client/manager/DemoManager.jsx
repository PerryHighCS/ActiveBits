import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import AlgorithmPicker from '../components/AlgorithmPicker';
import { getAllAlgorithms, getAlgorithm } from '../algorithms';
import { MESSAGE_TYPES, createMessage, normalizeAlgorithmState, messageReplacer } from '../utils';
import './DemoManager.css';

export default function DemoManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const algorithms = getAllAlgorithms();
  const [session, setSession] = useState(null);
  const [selectedAlgoId, setSelectedAlgoId] = useState(algorithms[0]?.id);
  const [algorithmState, setAlgorithmState] = useState(null);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [invalidAlgorithm, setInvalidAlgorithm] = useState(null);

  // Sync session state from server
  useEffect(() => {
    if (!sessionId) return;

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/algorithm-demo/${sessionId}/session`);
        if (res.ok) {
          const data = await res.json();
          setSession(data);
          if (data.data.algorithmId) {
            setSelectedAlgoId(data.data.algorithmId);
            setAlgorithmState(normalizeAlgorithmState(data.data.algorithmState) || null);
            setHasAutoSelected(true); // Already has an algorithm set
          }
        }
      } catch (err) {
        console.error('Failed to fetch session:', err);
      }
    };

    fetchSession();
  }, [sessionId]);

  // WebSocket connection
  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/algorithm-demo?sessionId=${sessionId}`;
  }, [sessionId]);

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: true,
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === MESSAGE_TYPES.STATE_SYNC) {
          setAlgorithmState(normalizeAlgorithmState(msg.payload));
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    },
  });

  useEffect(() => {
    if (!sessionId) return;
    connect();
    return () => disconnect();
  }, [sessionId, connect, disconnect]);

  // Auto-select algorithm from query params if provided and not already selected
  useEffect(() => {
    const algorithmParam = searchParams.get('algorithm');
    if (!algorithmParam || hasAutoSelected || !sessionId || !session) return;

    // Check if this algorithm exists
    const algo = getAlgorithm(algorithmParam);
    if (!algo) {
      console.warn(`[algorithm-demo] Algorithm "${algorithmParam}" not found in available algorithms`);
      setInvalidAlgorithm(algorithmParam);
      setHasAutoSelected(true);
      return;
    }

    // Only auto-select if no algorithm is currently selected
    if (!session.data.algorithmId) {
      console.log(`[algorithm-demo] Auto-selecting algorithm from URL: ${algorithmParam}`);
      handleSelectAlgorithm(algorithmParam);
    }
    setHasAutoSelected(true);
  }, [searchParams, hasAutoSelected, sessionId, session]);

  const handleSelectAlgorithm = async (algoId) => {
    setSelectedAlgoId(algoId);
    const algo = getAlgorithm(algoId);
    if (!algo) return;

    const newState = algo.initState ? algo.initState() : {};
    setAlgorithmState(newState);

    // Broadcast to all students
    if (socketRef.current?.readyState === 1) {
      socketRef.current.send(
        JSON.stringify(
          createMessage(MESSAGE_TYPES.ALGORITHM_SELECTED, newState, {
            algorithmId: algoId,
            sessionId,
          }),
          messageReplacer
        )
      );
    }

    // Persist to server
    await fetch(`/api/algorithm-demo/${sessionId}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithmId: algoId, algorithmState: newState }, messageReplacer),
    });
  };

  const handleStateChange = async (newState) => {
    setAlgorithmState(newState);

    // Broadcast state-sync
    if (socketRef.current?.readyState === 1) {
      const msg = JSON.stringify(
        createMessage(MESSAGE_TYPES.STATE_SYNC, newState, {
          algorithmId: selectedAlgoId,
          sessionId,
        }),
        messageReplacer
      );
      socketRef.current.send(msg);
    }

    // Persist to server
    await fetch(`/api/algorithm-demo/${sessionId}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithmState: newState }, messageReplacer),
    });
  };

  const handleEndSession = async () => {
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    navigate('/manage');
  };

  const currentAlgo = getAlgorithm(selectedAlgoId);
  if (!currentAlgo) {
    return <div className="error">Algorithm not found</div>;
  }

  const CurrentManagerView = currentAlgo.ManagerView;
  const isDeepLink = !!searchParams.get('algorithm');

  return (
    <div className="demo-manager">
      <SessionHeader
        activityName="Algorithm Demonstrations"
        sessionId={sessionId}
        onEndSession={handleEndSession}
      />

      {(invalidAlgorithm || !isDeepLink) && (
        <>
          {invalidAlgorithm && (
            <div className="bg-red-50 border-2 border-red-200 rounded p-4 mb-4">
              <p className="text-red-700 font-semibold">⚠️ Algorithm not found</p>
              <p className="text-red-600 text-sm">The algorithm "{invalidAlgorithm}" was not found. Please select an algorithm below.</p>
            </div>
          )}
          <AlgorithmPicker
            algorithms={algorithms}
            selectedId={selectedAlgoId}
            onSelect={(algoId) => {
              setInvalidAlgorithm(null);
              handleSelectAlgorithm(algoId);
            }}
            title="Select Algorithm to Demonstrate"
          />
        </>
      )}

      {algorithmState && (
        <div className="manager-view">
          <CurrentManagerView
            session={{
              id: sessionId,
              data: { algorithmState, algorithmId: selectedAlgoId },
            }}
            onStateChange={handleStateChange}
          />
        </div>
      )}
    </div>
  );
}
