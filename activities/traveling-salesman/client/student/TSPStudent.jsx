import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import Button from '@src/components/ui/Button';
import CityMap from '../components/CityMap.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import RouteLegend from '../components/RouteLegend.jsx';
import { calculateRouteDistance, buildDistanceMatrix, calculateCurrentDistance } from '../utils/distanceCalculator.js';
import { generateCities } from '../utils/cityGenerator.js';
import { factorial } from '../utils/mathHelpers.js';
import { solveTSPBruteForce } from '../utils/bruteForce.js';
import { solveTSPNearestNeighbor } from '../utils/nearestNeighbor.js';
import './TSPStudent.css';

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
  const [numCities, setNumCities] = useState(6);
  const [soloAlgorithms, setSoloAlgorithms] = useState({ bruteForce: null, heuristic: null });
  const [soloComputing, setSoloComputing] = useState(false);
  const [soloTimeToComplete, setSoloTimeToComplete] = useState(null);
  const [soloActiveViewId, setSoloActiveViewId] = useState(null);
  const [soloBruteForceStarted, setSoloBruteForceStarted] = useState(false);
  const [soloStartCityId, setSoloStartCityId] = useState(null);
  const [soloProgress, setSoloProgress] = useState({
    bruteForce: { current: 0, total: 0, running: false },
    heuristic: { current: 0, total: 0, running: false }
  });

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
    if (isSoloSession && currentRoute.length === 0) {
      setSoloStartCityId(city.id);
      computeSoloAlgorithms(city.id, { runHeuristic: true, runBruteForce: !soloBruteForceStarted });
    }

    const newCurrentDistance = calculateCurrentDistance(newRoute, distanceMatrix);
    setCurrentDistance(newCurrentDistance);

    // Check if complete
    if (newRoute.length === cities.length) {
      const distance = calculateRouteDistance(newRoute, distanceMatrix);
      const completionTime = Date.now();
      const timeToComplete = Math.floor((completionTime - startTime) / 1000);

      setIsComplete(true);
      setRouteDistance(distance);
      if (isSoloSession) {
        setSoloTimeToComplete(timeToComplete);
      }
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
    setSoloTimeToComplete(null);
    setSoloActiveViewId(null);
    setSoloStartCityId(null);
    if (isSoloSession) {
      setSoloAlgorithms(prev => ({ ...prev, heuristic: null }));
      setSoloProgress(prev => ({
        ...prev,
        heuristic: { current: 0, total: (cities.length || numCities), running: false }
      }));
      if (soloAlgorithms?.bruteForce?.cancelled) {
        setSoloBruteForceStarted(false);
      }
    }
  };

  const handleGenerateSoloMap = () => {
    const seed = Date.now();
    const generatedCities = generateCities(numCities, 700, 500, seed);
    const matrix = buildDistanceMatrix(generatedCities);
    setCities(generatedCities);
    setDistanceMatrix(matrix);
    setTerrainSeed(seed);
    setSoloAlgorithms({ bruteForce: null, heuristic: null });
    setSoloComputing(false);
    setSoloBruteForceStarted(false);
    setSoloProgress({
      bruteForce: { current: 0, total: factorial(numCities - 1), running: false },
      heuristic: { current: 0, total: numCities, running: false }
    });
    setSoloStartCityId(null);
    resetRoute();
  };

  const computeSoloAlgorithms = async (startCityOverride = null, options = {}) => {
    if (!cities.length || !distanceMatrix.length) return;
    const { runHeuristic = true, runBruteForce = true } = options;
    const startId = startCityOverride || soloStartCityId;
    const startIndex = startId ? parseInt(startId.split('-')[1], 10) : 0;
    const shouldRunBruteForce = runBruteForce && !soloBruteForceStarted;

    if (!runHeuristic && !shouldRunBruteForce) return;

    if (runHeuristic) {
      setSoloProgress(prev => ({
        ...prev,
        heuristic: { current: 0, total: cities.length, running: true }
      }));
    }

    if (shouldRunBruteForce) {
      setSoloBruteForceStarted(true);
      setSoloComputing(true);
      setSoloProgress(prev => ({
        ...prev,
        bruteForce: { current: 0, total: factorial(cities.length - 1), running: true }
      }));
    }

    try {
      if (runHeuristic) {
        const heuristicStart = performance.now();
        const heuristicResult = solveTSPNearestNeighbor(cities, distanceMatrix, { startIndex });
        const heuristicEnd = performance.now();
        const heuristicTime = ((heuristicEnd - heuristicStart) / 1000).toFixed(3);
        setSoloProgress(prev => ({
          ...prev,
          heuristic: { current: prev.heuristic.total || cities.length, total: prev.heuristic.total || cities.length, running: false }
        }));
        setSoloAlgorithms(prev => ({
          ...prev,
          heuristic: {
            ...heuristicResult,
            computeTime: heuristicTime,
            name: 'Nearest Neighbor'
          }
        }));
      }

      if (shouldRunBruteForce) {
        const bruteForceStart = performance.now();
        const bruteForceResult = await solveTSPBruteForce(cities, distanceMatrix, {
          startIndex,
          onProgress: (checked, total) => {
            setSoloProgress(prev => ({
              ...prev,
              bruteForce: { current: checked, total, running: true }
            }));
          }
        });
        const bruteForceEnd = performance.now();
        const bruteForceTime = bruteForceResult.cancelled
          ? null
          : ((bruteForceEnd - bruteForceStart) / 1000).toFixed(3);
        setSoloProgress(prev => ({
          ...prev,
          bruteForce: {
            current: prev.bruteForce.total || bruteForceResult.totalChecks,
            total: prev.bruteForce.total || bruteForceResult.totalChecks,
            running: false
          }
        }));

        setSoloAlgorithms(prev => ({
          ...prev,
          bruteForce: {
            ...bruteForceResult,
            computeTime: bruteForceTime,
            name: 'Brute Force (Optimal)'
          }
        }));
      }
    } catch (err) {
      console.error('Failed to compute solo algorithms:', err);
    } finally {
      if (shouldRunBruteForce) {
        setSoloComputing(false);
      }
    }
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

  if (cities.length === 0 && !isSoloSession) {
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
  const soloDisplayedRoutes = isSoloSession ? [
    ...(soloActiveViewId === 'bruteforce' && soloAlgorithms.bruteForce?.route ? [{
      id: 'bruteforce',
      path: soloAlgorithms.bruteForce.route,
      type: 'bruteforce',
      name: soloAlgorithms.bruteForce.name,
      distance: soloAlgorithms.bruteForce.distance
    }] : []),
    ...(soloActiveViewId === 'heuristic' && soloAlgorithms.heuristic?.route ? [{
      id: 'heuristic',
      path: soloAlgorithms.heuristic.route,
      type: 'heuristic',
      name: soloAlgorithms.heuristic.name,
      distance: soloAlgorithms.heuristic.distance
    }] : [])
  ] : [];
  const displayedRoutes = isSoloSession ? soloDisplayedRoutes : sortedBroadcastedRoutes;
  const legendItems = [
    ...(currentRoute.length > 0 ? [{
      id: 'student',
      type: 'student',
      label: 'My Route',
      distance: isComplete ? routeDistance : currentDistance
    }] : []),
    ...displayedRoutes.map(route => ({
      id: route.id,
      type: route.type,
      label: route.name,
      distance: route.distance ?? null,
      progressCurrent: route.progressCurrent ?? null,
      progressTotal: route.progressTotal ?? null
    }))
  ];

  const showSoloAlgorithms = isSoloSession && cities.length > 0
    && (currentRoute.length > 0
      || soloBruteForceStarted
      || soloComputing
      || soloProgress.bruteForce.running
      || soloProgress.heuristic.running
      || soloAlgorithms.bruteForce
      || soloAlgorithms.heuristic);
  const soloLeaderboardEntries = isSoloSession ? [
    ...(currentRoute.length > 0 ? [{
      id: 'solo-student',
      name: 'My Route',
      distance: isComplete ? routeDistance : currentDistance,
      timeToComplete: isComplete ? soloTimeToComplete : null,
      type: 'student'
    }] : []),
    ...(showSoloAlgorithms ? [{
      id: 'bruteforce',
      name: 'Brute Force (Optimal)',
      distance: soloAlgorithms.bruteForce?.distance ?? null,
      timeToComplete: soloAlgorithms.bruteForce?.computeTime ?? null,
      progressCurrent: soloProgress.bruteForce.running ? soloProgress.bruteForce.current : null,
      progressTotal: soloProgress.bruteForce.running ? soloProgress.bruteForce.total : null,
      type: 'bruteforce'
    }, {
      id: 'heuristic',
      name: 'Nearest Neighbor',
      distance: soloAlgorithms.heuristic?.distance ?? null,
      timeToComplete: soloAlgorithms.heuristic?.computeTime ?? null,
      progressCurrent: soloProgress.heuristic.running ? soloProgress.heuristic.current : null,
      progressTotal: soloProgress.heuristic.running ? soloProgress.heuristic.total : null,
      type: 'heuristic'
    }] : [])
  ] : [];
  const sortedSoloLeaderboardEntries = isSoloSession
    ? [...soloLeaderboardEntries].sort((a, b) => {
      const isInProgress = (entry) => {
        if (entry.type === 'student') return !isComplete;
        return entry.progressCurrent !== null && entry.progressCurrent !== undefined;
      };
      const aInProgress = isInProgress(a);
      const bInProgress = isInProgress(b);
      if (aInProgress !== bInProgress) return aInProgress ? 1 : -1;
      const aDistance = a.distance ?? Infinity;
      const bDistance = b.distance ?? Infinity;
      return aDistance - bDistance;
    })
    : [];

  return (
    <div className="tsp-student">
      <div className="student-header">
        <h2>Build Your Route</h2>
        <p className="instructions">Click cities in the order you want to visit them</p>
      </div>

      <div className="student-layout">
        <div className="student-info-panel">
          {isSoloSession && (
            <>
              <div className="info-line">Map Setup</div>
              <label className="info-line">
                Number of Cities:
                <select
                  className="city-count-select"
                  value={numCities}
                  onChange={(e) => setNumCities(Number(e.target.value))}
                >
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={6}>6</option>
                  <option value={7}>7</option>
                  <option value={8}>8</option>
                  <option value={9}>9</option>
                  <option value={10}>10</option>
                  <option value={11}>11</option>
                  <option value={12}>12</option>
                </select>
              </label>
              <Button onClick={handleGenerateSoloMap}>Generate Map</Button>
            </>
          )}
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
          {isSoloSession && cities.length === 0 ? (
            <div className="student-map-placeholder">
              <div className="student-map-placeholder-text">Generate a map to get started</div>
            </div>
          ) : (
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
                ...(isSoloSession ? soloDisplayedRoutes : broadcastedRoutes)
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
          )}
          {legendItems.length > 0 && (
            <RouteLegend title="Legend" items={legendItems} />
          )}
        </div>

      </div>
      {isSoloSession && soloLeaderboardEntries.length > 0 && (
        <div className="solo-leaderboard">
          <Leaderboard
            entries={sortedSoloLeaderboardEntries}
            onHighlight={(entry) => {
              setSoloActiveViewId((prev) => (prev === entry.id ? null : entry.id));
            }}
            activeViewId={soloActiveViewId}
            viewableTypes={['bruteforce', 'heuristic']}
            onBroadcast={null}
          />
        </div>
      )}
    </div>
  );
}
