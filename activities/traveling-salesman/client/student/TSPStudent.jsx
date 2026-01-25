import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import Button from '@src/components/ui/Button';
import CityMap from '../components/CityMap.jsx';
import RouteLegend from '../components/RouteLegend.jsx';
import { calculateRouteDistance } from '../utils/distanceCalculator.js';
import './TSPStudent.css';

const calculateCurrentDistance = (route, distanceMatrix) => {
  if (!route || route.length <= 1) return 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const from = parseInt(route[i].split('-')[1], 10);
    const to = parseInt(route[i + 1].split('-')[1], 10);
    total += distanceMatrix?.[from]?.[to] || 0;
  }
  return total;
};

/**
 * TSPStudent - Student view for building TSP routes
 * Students click cities in order to build their route
 * Routes are submitted to server and tracked in leaderboard
 */
export default function TSPStudent({ sessionData }) {
  const sessionId = sessionData?.sessionId;
  const isSoloSession = sessionId ? sessionId.startsWith('solo-') : false;
  const navigate = useNavigate();
  const attachSessionEndedHandler = useSessionEndedHandler();
  const studentIdRef = useRef(null);

  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState(null);
  const [nameSubmitted, setNameSubmitted] = useState(false);

  const [cities, setCities] = useState([]);
  const [distanceMatrix, setDistanceMatrix] = useState([]);
  const [terrainSeed, setTerrainSeed] = useState(Date.now());
  const [currentRoute, setCurrentRoute] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [routeStartTime, setRouteStartTime] = useState(null);
  const [routeDistance, setRouteDistance] = useState(0);
  const [broadcastedRoutes, setBroadcastedRoutes] = useState([]);
  const [hoveredCityId, setHoveredCityId] = useState(null);
  const [currentDistance, setCurrentDistance] = useState(0);

  // Load saved student info
  useEffect(() => {
    if (isSoloSession) {
      setStudentName('Solo Student');
      setStudentId('solo-user');
      setNameSubmitted(true);
      return;
    }

    const savedName = localStorage.getItem(`student-name-${sessionId}`);
    const savedId = localStorage.getItem(`student-id-${sessionId}`);
    if (savedName) {
      setStudentName(savedName);
      setStudentId(savedId);
      setNameSubmitted(true);
    }
  }, [sessionId, isSoloSession]);

  // Fetch initial problem state
  const fetchProblem = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`);
      if (!res.ok) throw new Error('Failed to fetch session');
      const data = await res.json();

      if (data.problem && data.problem.cities) {
        setCities(data.problem.cities);
        setDistanceMatrix(data.problem.distanceMatrix);
        setTerrainSeed(data.problem.seed || Date.now());
      }
    } catch (err) {
      console.error('Failed to fetch problem:', err);
    }
  }, [sessionId]);

  const restoreStudentRoute = useCallback(async (idToRestore) => {
    if (!sessionId || !idToRestore) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`);
      if (!res.ok) throw new Error('Failed to fetch session');
      const data = await res.json();
      const student = data.students?.find(s => s.id === idToRestore);
      if (student && Array.isArray(student.currentRoute)) {
        setCurrentRoute(student.currentRoute);
        setIsComplete(Boolean(student.complete));
        const matrix = data.problem?.distanceMatrix || distanceMatrix;
        const totalDistance = student.routeDistance ?? calculateRouteDistance(student.currentRoute, matrix);
        if (student.complete) {
          setRouteDistance(totalDistance || 0);
          setCurrentDistance(totalDistance || 0);
        } else {
          setRouteDistance(0);
          setCurrentDistance(calculateCurrentDistance(student.currentRoute, matrix));
        }
      }
    } catch (err) {
      console.error('Failed to restore student route:', err);
    }
  }, [sessionId, distanceMatrix]);

  useEffect(() => {
    studentIdRef.current = studentId;
  }, [studentId]);

  useEffect(() => {
    if (!studentId || isSoloSession) return;
    restoreStudentRoute(studentId);
  }, [studentId, isSoloSession, restoreStudentRoute]);

  // WebSocket handlers
  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === 'session-ended') {
        navigate('/session-ended');
        return;
      }
      if (message.type === 'clearBroadcast') {
        setBroadcastedRoutes([]);
        return;
      }
      if (message.type === 'broadcastUpdate' && (!message.payload?.routes || message.payload.routes.length === 0)) {
        setBroadcastedRoutes([]);
        return;
      }
      if (message.type === 'studentId') {
        const newStudentId = message.payload.studentId;
        setStudentId(newStudentId);
        localStorage.setItem(`student-id-${sessionId}`, newStudentId);
      } else if (message.type === 'problemUpdate') {
        setCities(message.payload.cities);
        setDistanceMatrix(message.payload.distanceMatrix);
        setTerrainSeed(message.payload.seed || Date.now());
        // Reset route when new problem is generated
        setCurrentRoute([]);
        setIsComplete(false);
        setRouteStartTime(null);
        setRouteDistance(0);
        setCurrentDistance(0);
        setHoveredCityId(null);
      } else if (message.type === 'broadcastUpdate') {
        const routes = (message.payload?.routes || []).map((route) => ({
          ...route,
          path: route.path || route.route
        }));
        setBroadcastedRoutes(routes);
      } else if (message.type === 'highlightSolution') {
        if (!message.payload) {
          setBroadcastedRoutes([]);
          return;
        }
        setBroadcastedRoutes([{
          id: message.payload.id,
          path: message.payload.route,
          type: message.payload.type,
          name: message.payload.name,
          distance: message.payload.distance,
          timeToComplete: message.payload.timeToComplete
        }]);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, [navigate, sessionId]);

  const buildWsUrl = useCallback(() => {
    if (!nameSubmitted || isSoloSession) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const currentId = studentIdRef.current;
    const studentIdParam = currentId ? `&studentId=${encodeURIComponent(currentId)}` : '';
    return `${protocol}//${host}/ws/traveling-salesman?sessionId=${sessionId}&studentName=${encodeURIComponent(studentName)}${studentIdParam}`;
  }, [nameSubmitted, sessionId, studentName, isSoloSession]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(nameSubmitted && !isSoloSession),
    onOpen: () => fetchProblem(),
    onMessage: handleWsMessage,
    attachSessionEndedHandler,
  });

  useEffect(() => {
    if (!nameSubmitted || isSoloSession) {
      disconnect();
      return undefined;
    }
    connect();
    return () => disconnect();
  }, [nameSubmitted, isSoloSession, connect, disconnect]);

  // Load problem on mount for solo mode
  useEffect(() => {
    if (isSoloSession && nameSubmitted) {
      fetchProblem();
    }
  }, [isSoloSession, nameSubmitted, fetchProblem]);

  // Handle city click
  const handleCityClick = (city) => {
    if (isComplete) return;

    if (currentRoute.includes(city.id)) {
      // City already visited
      return;
    }

    // Track start time on first click
    const now = Date.now();
    const startTime = routeStartTime ?? now;
    if (routeStartTime === null) {
      setRouteStartTime(startTime);
    }

    const newRoute = [...currentRoute, city.id];
    setCurrentRoute(newRoute);

    const newCurrentDistance = calculateCurrentDistance(newRoute, distanceMatrix);
    setCurrentDistance(newCurrentDistance);

    // Check if complete
    if (newRoute.length === cities.length) {
      const distance = calculateRouteDistance(newRoute, distanceMatrix);
      const completionTime = Date.now();
      const timeToComplete = Math.floor((completionTime - startTime) / 1000);

      setIsComplete(true);
      setRouteDistance(distance);
      submitRoute(newRoute, distance, timeToComplete);
    } else {
      submitRoute(newRoute, newCurrentDistance, null);
    }
  };

  const submitRoute = async (route, distance, timeToComplete) => {
    if (isSoloSession) return; // No submission for solo mode

    try {
      await fetch(`/api/traveling-salesman/${sessionId}/submit-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          route,
          distance,
          timeToComplete,
        })
      });
    } catch (err) {
      console.error('Failed to submit route:', err);
    }
  };

  const resetRoute = () => {
    setCurrentRoute([]);
    setIsComplete(false);
    setRouteStartTime(null);
    setRouteDistance(0);
    setCurrentDistance(0);
  };

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (studentName.trim()) {
      setNameSubmitted(true);
      localStorage.setItem(`student-name-${sessionId}`, studentName);
    }
  };

  if (!nameSubmitted && !isSoloSession) {
    return (
      <div className="tsp-student-setup">
        <h2>Enter Your Name</h2>
        <form onSubmit={handleNameSubmit}>
          <input
            type="text"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Your name"
            className="name-input"
            autoFocus
          />
          <Button type="submit">Join</Button>
        </form>
      </div>
    );
  }

  if (cities.length === 0) {
    return (
      <div className="tsp-student">
        <h2>Traveling Salesman Challenge</h2>
        <p>Waiting for instructor to generate a map...</p>
      </div>
    );
  }

  const sortedBroadcastedRoutes = [...broadcastedRoutes].sort((a, b) => {
    const aDistance = a.distance ?? Infinity;
    const bDistance = b.distance ?? Infinity;
    return aDistance - bDistance;
  });
  const legendItems = [
    ...(currentRoute.length > 0 ? [{
      id: 'student',
      type: 'student',
      label: 'My Route',
      distance: isComplete ? routeDistance : currentDistance
    }] : []),
    ...sortedBroadcastedRoutes.map(route => ({
      id: route.id,
      type: route.type,
      label: route.name,
      distance: route.distance ?? null,
      progressCurrent: route.progressCurrent ?? null,
      progressTotal: route.progressTotal ?? null
    }))
  ];

  return (
    <div className="tsp-student">
      <div className="student-header">
        <h2>Build Your Route</h2>
        <p className="instructions">Click cities in the order you want to visit them</p>
      </div>

      <div className="student-layout">
        <div className="student-info-panel">
          <div className="info-line">
            Cities visited: {currentRoute.length} / {cities.length}
          </div>
          <div className={`info-line ${isComplete ? 'complete' : ''}`}>
            {isComplete ? 'Total distance' : 'Current distance'}: {isComplete ? routeDistance.toFixed(1) : currentDistance.toFixed(1)}
          </div>
          <Button onClick={resetRoute} disabled={currentRoute.length === 0}>
            Reset Route
          </Button>
        </div>

        <div className="student-map-panel">
          <CityMap
            cities={cities}
            routes={[
              // Student's own route
              ...(currentRoute.length > 0 ? [{
                id: 'student',
                path: currentRoute,
                type: 'student'
              }] : []),
              // Broadcasted routes
              ...broadcastedRoutes
            ]}
            highlightedRoute={null}
            onCityClick={handleCityClick}
            onCityHover={(city) => setHoveredCityId(city.id)}
            onCityLeave={() => setHoveredCityId(null)}
            distanceMatrix={distanceMatrix}
            activeRoute={currentRoute}
            hoverRoute={currentRoute}
            hoveredCityId={hoveredCityId}
            terrainSeed={terrainSeed}
          />
          {legendItems.length > 0 && (
            <RouteLegend title="Legend" items={legendItems} />
          )}
        </div>
      </div>
    </div>
  );
}
