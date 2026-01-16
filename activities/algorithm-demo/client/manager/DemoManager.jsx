import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import AlgorithmPicker from '../components/AlgorithmPicker';
import { getAllAlgorithms, getAlgorithm } from '../algorithms';
import { MESSAGE_TYPES, createMessage, normalizeAlgorithmState, messageReplacer } from '../utils';
import './DemoManager.css';

export default function DemoManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [algorithms] = useState(getAllAlgorithms());
  const [session, setSession] = useState(null);
  const [selectedAlgoId, setSelectedAlgoId] = useState(algorithms[0]?.id);
  const [algorithmState, setAlgorithmState] = useState(null);

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

  return (
    <div className="demo-manager">
      <SessionHeader
        activityName="Algorithm Demonstrations"
        sessionId={sessionId}
        onEndSession={handleEndSession}
      />

      <AlgorithmPicker
        algorithms={algorithms}
        selectedId={selectedAlgoId}
        onSelect={handleSelectAlgorithm}
        title="Select Algorithm to Demonstrate"
      />

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
