import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useTspSession } from '../hooks/useTspSession.js';
import { useRouteBuilder } from '../hooks/useRouteBuilder.js';
import Button from '@src/components/ui/Button';
import CityMap from '../components/CityMap.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import RouteLegend from '../components/RouteLegend.jsx';
import { buildLegendItems } from '../utils/routeLegend.js';
import { buildSoloLeaderboardEntries } from '../utils/leaderboardBuilders.js';
import { buildDistanceMatrix, getRouteDistance } from '../utils/distanceCalculator.js';
import { formatDistance } from '../utils/formatters.js';
import { generateCities } from '../utils/cityGenerator.js';
import { factorial } from '../utils/mathHelpers.js';
import { runBruteForce, runHeuristic } from '../utils/algorithmRunner.js';
import { buildMapRenderProps } from '../utils/mapRenderConfig.js';
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
  const [broadcastedRoutes, setBroadcastedRoutes] = useState([]);
  const [hoveredCityId, setHoveredCityId] = useState(null);
  const [numCities, setNumCities] = useState(6);
  const [soloAlgorithms, setSoloAlgorithms] = useState({ bruteForce: null, heuristic: null });
  const [soloComputing, setSoloComputing] = useState(false);
  const [soloActiveViewId, setSoloActiveViewId] = useState(null);
  const [soloBruteForceStarted, setSoloBruteForceStarted] = useState(false);
  const [soloStartCityId, setSoloStartCityId] = useState(null);
  const soloCancelRef = useRef(false);
  const [soloProgress, setSoloProgress] = useState({
    bruteForce: { current: 0, total: 0, running: false },
    heuristic: { current: 0, total: 0, running: false }
  });
  const routeBuilder = useRouteBuilder({
    cityCount: cities.length,
    distanceMatrix
  });
  const currentRoute = routeBuilder.route;
  const isComplete = routeBuilder.isComplete;
  const routeDistance = routeBuilder.totalDistance;
  const currentDistance = routeBuilder.currentDistance;
  const timeToComplete = routeBuilder.timeToComplete;
  const { addCity, hydrateRoute, resetRoute: resetBuiltRoute } = routeBuilder;

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

  const restoreStudentRoute = useCallback(async (idToRestore) => {
    if (!sessionId || !idToRestore) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`);
      if (!res.ok) throw new Error('Failed to fetch session');
      const data = await res.json();
      const student = data.students?.find(s => s.id === idToRestore);
      if (student && Array.isArray(student.currentRoute)) {
        const matrix = data.problem?.distanceMatrix || distanceMatrix;
        const totalDistance = student.routeDistance ?? getRouteDistance(student.currentRoute, matrix, true);
        hydrateRoute({
          route: student.currentRoute,
          complete: Boolean(student.complete),
          distance: student.complete ? totalDistance : null,
          timeToComplete: student.timeToComplete ?? null
        });
      }
    } catch (err) {
      console.error('Failed to restore student route:', err);
    }
  }, [sessionId, distanceMatrix, hydrateRoute]);

  useEffect(() => {
    studentIdRef.current = studentId;
  }, [studentId]);

  useEffect(() => {
    if (!studentId || isSoloSession) return;
    restoreStudentRoute(studentId);
  }, [studentId, isSoloSession, restoreStudentRoute]);

  // WebSocket handlers
  const handleWsMessage = useCallback((message) => {
    try {
      const payload = typeof message === 'string' ? JSON.parse(message) : message;
      if (!payload?.type) return;

      if (payload.type === 'session-ended') {
        navigate('/session-ended');
        return;
      }
      if (payload.type === 'clearBroadcast') {
        setBroadcastedRoutes([]);
        return;
      }
      if (payload.type === 'broadcastUpdate' && (!payload.payload?.routes || payload.payload.routes.length === 0)) {
        setBroadcastedRoutes([]);
        return;
      }
      if (payload.type === 'studentId') {
        const newStudentId = payload.payload.studentId;
        setStudentId(newStudentId);
        localStorage.setItem(`student-id-${sessionId}`, newStudentId);
      } else if (payload.type === 'problemUpdate') {
        setCities(payload.payload.cities);
        setDistanceMatrix(payload.payload.distanceMatrix);
        setTerrainSeed(payload.payload.seed || Date.now());
        // Reset route when new problem is generated
        resetBuiltRoute();
        setHoveredCityId(null);
      } else if (payload.type === 'broadcastUpdate') {
        setBroadcastedRoutes(payload.payload?.routes || []);
      } else if (payload.type === 'highlightSolution') {
        if (!payload.payload) {
          setBroadcastedRoutes([]);
          return;
        }
        setBroadcastedRoutes([{
          id: payload.payload.id,
          path: payload.payload.path,
          type: payload.payload.type,
          name: payload.payload.name,
          distance: payload.payload.distance,
          timeToComplete: payload.payload.timeToComplete
        }]);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, [navigate, sessionId, resetBuiltRoute]);

  const buildWsUrl = useCallback(() => {
    if (!nameSubmitted || isSoloSession) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const currentId = studentIdRef.current;
    const studentIdParam = currentId ? `&studentId=${encodeURIComponent(currentId)}` : '';
    return `${protocol}//${host}/ws/traveling-salesman?sessionId=${sessionId}&studentName=${encodeURIComponent(studentName)}${studentIdParam}`;
  }, [nameSubmitted, sessionId, studentName, isSoloSession]);

  const handleSessionUpdate = useCallback((data) => {
    if (data.problem && data.problem.cities) {
      setCities(data.problem.cities);
      setDistanceMatrix(data.problem.distanceMatrix);
      setTerrainSeed(data.problem.seed || Date.now());
    }
  }, []);

  const { connect, disconnect } = useTspSession({
    sessionId,
    buildWsUrl,
    shouldReconnect: Boolean(nameSubmitted && !isSoloSession),
    onMessage: handleWsMessage,
    onSession: handleSessionUpdate,
    attachSessionEndedHandler
  });

  useEffect(() => {
    if (!nameSubmitted || isSoloSession) {
      disconnect();
      return undefined;
    }
    connect();
    return () => disconnect();
  }, [nameSubmitted, isSoloSession, connect, disconnect]);

  // Handle city click
  const handleCityClick = (city) => {
    if (isComplete) return;

    if (currentRoute.includes(city.id)) {
      // City already visited
      return;
    }

    const result = addCity(city.id);
    if (!result) return;
    if (isSoloSession && currentRoute.length === 0) {
      setSoloStartCityId(city.id);
      computeSoloAlgorithms(city.id, { runHeuristic: true, runBruteForce: !soloBruteForceStarted });
    }
    if (result.isComplete) {
      submitRoute(result.route, result.totalDistance, result.timeToComplete);
    } else {
      submitRoute(result.route, result.currentDistance, null);
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
    resetBuiltRoute();
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
    soloCancelRef.current = true;
    setSoloProgress({
      bruteForce: { current: 0, total: factorial(numCities - 1), running: false },
      heuristic: { current: 0, total: numCities, running: false }
    });
    setSoloStartCityId(null);
    resetRoute();
  };

  const computeSoloAlgorithms = async (startCityOverride = null, options = {}) => {
    if (!cities.length || !distanceMatrix.length) return;
    const { runHeuristic: shouldRunHeuristic = true, runBruteForce: shouldRunBruteForceOption = true } = options;
    const startId = startCityOverride || soloStartCityId;
    const startIndex = startId ? parseInt(startId.split('-')[1], 10) : 0;
    const shouldRunBruteForce = shouldRunBruteForceOption && !soloBruteForceStarted;

    if (!shouldRunHeuristic && !shouldRunBruteForce) return;

    if (shouldRunHeuristic) {
      setSoloProgress(prev => ({
        ...prev,
        heuristic: { current: 0, total: cities.length, running: true }
      }));
    }

    if (shouldRunBruteForce) {
      setSoloBruteForceStarted(true);
      setSoloComputing(true);
      soloCancelRef.current = false;
      setSoloProgress(prev => ({
        ...prev,
        bruteForce: { current: 0, total: factorial(cities.length - 1), running: true }
      }));
    }

    try {
      if (shouldRunHeuristic) {
        const heuristicResult = runHeuristic({ cities, distanceMatrix, startIndex });
        setSoloProgress(prev => ({
          ...prev,
          heuristic: { current: prev.heuristic.total || cities.length, total: prev.heuristic.total || cities.length, running: false }
        }));
        setSoloAlgorithms(prev => ({
          ...prev,
          heuristic: {
            ...heuristicResult,
            computeTime: heuristicResult.computeTime,
            name: 'Nearest Neighbor'
          }
        }));
      }

      if (shouldRunBruteForce) {
        const bruteForceResult = await runBruteForce({
          cities,
          distanceMatrix,
          startIndex,
          onProgress: (checked, total) => {
            setSoloProgress(prev => ({
              ...prev,
              bruteForce: { current: checked, total, running: true }
            }));
          },
          shouldCancel: () => soloCancelRef.current
        });
        const bruteForceTime = bruteForceResult.computeTime;
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
  const legendItems = buildLegendItems({
    primary: currentRoute.length > 0
      ? {
        id: 'student',
        type: 'student',
        label: 'My Route',
        distance: isComplete ? routeDistance : currentDistance
      }
      : null,
    routes: displayedRoutes.map(route => ({
      ...route,
      label: route.name
    }))
  });

  const {
    entries: soloLeaderboardEntries,
    sortedEntries: sortedSoloLeaderboardEntries
  } = buildSoloLeaderboardEntries({
    isSoloSession,
    currentRoute,
    isComplete,
    routeDistance,
    currentDistance,
    timeToComplete,
    soloAlgorithms,
    soloProgress,
    soloBruteForceStarted,
    soloComputing,
    citiesLength: cities.length
  });

  const mapRenderProps = buildMapRenderProps({
    activeRoute: currentRoute,
    hoverRoute: currentRoute,
    hoveredCityId,
    terrainSeed
  });

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
            {isComplete ? 'Total distance' : 'Current distance'}: {formatDistance(isComplete ? routeDistance : currentDistance)}
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
              {...mapRenderProps}
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
