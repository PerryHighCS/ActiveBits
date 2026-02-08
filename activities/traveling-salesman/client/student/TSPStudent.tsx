import { useState, useEffect, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useTspSession } from '../hooks/useTspSession';
import { useRouteBuilder } from '../hooks/useRouteBuilder';
import Button from '@src/components/ui/Button';
import CityMap from '../components/CityMap';
import Leaderboard from '../components/Leaderboard';
import RouteLegend from '../components/RouteLegend';
import { buildLegendItems } from '../utils/routeLegend';
import { buildSoloLeaderboardEntries } from '../utils/leaderboardBuilders';
import { buildDistanceMatrix, getRouteDistance } from '../utils/distanceCalculator';
import { formatDistance } from '../utils/formatters';
import { generateCities } from '../utils/cityGenerator';
import { factorial } from '../utils/mathHelpers';
import { runBruteForce, runHeuristic } from '../utils/algorithmRunner';
import { buildMapRenderProps } from '../utils/mapRenderConfig';
import type {
  City,
  DistanceMatrix,
  SoloAlgorithmsState,
  SoloProgressState,
  TspDisplayRoute,
  TspSessionData,
  TspSessionMessage,
} from '../utils/tspUtilsTypes';
import './TSPStudent.css';

interface TSPStudentProps {
  sessionData?: {
    sessionId?: string
  }
}

interface ComputeSoloOptions {
  runHeuristic?: boolean
  runBruteForce?: boolean
}

function isDisplayRoute(value: unknown): value is TspDisplayRoute {
  return Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function getRouteStartIndex(cityId: string | null): number {
  if (!cityId) return 0
  const raw = cityId.split('-')[1]
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortRoutesByDistance(routes: TspDisplayRoute[]): TspDisplayRoute[] {
  return [...routes].sort((a, b) => {
    const aDistance = a.distance ?? Infinity
    const bDistance = b.distance ?? Infinity
    return aDistance - bDistance
  })
}

export function buildSoloDisplayedRoutes(
  isSoloSession: boolean,
  soloActiveViewId: string | null,
  soloAlgorithms: SoloAlgorithmsState,
): TspDisplayRoute[] {
  if (!isSoloSession) return []
  return [
    ...(soloActiveViewId === 'bruteforce' && soloAlgorithms.bruteForce?.route
      ? [
          {
            id: 'bruteforce',
            path: soloAlgorithms.bruteForce.route,
            type: 'bruteforce',
            name: soloAlgorithms.bruteForce.name,
            distance: soloAlgorithms.bruteForce.distance,
          } as TspDisplayRoute,
        ]
      : []),
    ...(soloActiveViewId === 'heuristic' && soloAlgorithms.heuristic?.route
      ? [
          {
            id: 'heuristic',
            path: soloAlgorithms.heuristic.route,
            type: 'heuristic',
            name: soloAlgorithms.heuristic.name,
            distance: soloAlgorithms.heuristic.distance,
          } as TspDisplayRoute,
        ]
      : []),
  ]
}

/**
 * TSPStudent - Student view for building TSP routes
 * Students click cities in order to build their route
 * Routes are submitted to server and tracked in leaderboard
 */
export default function TSPStudent({ sessionData }: TSPStudentProps) {
  const sessionId = sessionData?.sessionId;
  const isSoloSession = sessionId ? sessionId.startsWith('solo-') : false;
  const navigate = useNavigate();
  const attachSessionEndedHandler = useSessionEndedHandler();
  const studentIdRef = useRef<string | null>(null);

  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [nameSubmitted, setNameSubmitted] = useState(false);

  const [cities, setCities] = useState<City[]>([]);
  const [distanceMatrix, setDistanceMatrix] = useState<DistanceMatrix>([]);
  const [terrainSeed, setTerrainSeed] = useState(Date.now());
  const [broadcastedRoutes, setBroadcastedRoutes] = useState<TspDisplayRoute[]>([]);
  const [hoveredCityId, setHoveredCityId] = useState<string | null>(null);
  const [numCities, setNumCities] = useState(6);
  const [soloAlgorithms, setSoloAlgorithms] = useState<SoloAlgorithmsState>({ bruteForce: null, heuristic: null });
  const [soloComputing, setSoloComputing] = useState(false);
  const [soloActiveViewId, setSoloActiveViewId] = useState<string | null>(null);
  const [soloBruteForceStarted, setSoloBruteForceStarted] = useState(false);
  const [soloStartCityId, setSoloStartCityId] = useState<string | null>(null);
  const soloCancelRef = useRef(false);
  const [soloProgress, setSoloProgress] = useState<SoloProgressState>({
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

  const restoreStudentRoute = useCallback(async (idToRestore: string) => {
    if (!sessionId || !idToRestore) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`);
      if (!res.ok) throw new Error('Failed to fetch session');
      const data = (await res.json()) as TspSessionData;
      const student = data.students?.find((s) => s.id === idToRestore);
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
  const handleWsMessage = useCallback((message: TspSessionMessage) => {
    try {
      const payload = typeof message === 'string' ? (JSON.parse(message) as TspSessionMessage) : message;
      if (!payload?.type) return;
      if (typeof payload.type !== 'string') return;

      if (payload.type === 'session-ended') {
        navigate('/session-ended');
        return;
      }
      if (payload.type === 'clearBroadcast') {
        setBroadcastedRoutes([]);
        return;
      }
      const payloadBody = payload.payload && typeof payload.payload === 'object'
        ? (payload.payload as Record<string, unknown>)
        : null;
      const payloadRoutes = Array.isArray(payloadBody?.routes)
        ? (payloadBody.routes.filter(isDisplayRoute) as TspDisplayRoute[])
        : [];

      if (payload.type === 'broadcastUpdate' && payloadRoutes.length === 0) {
        setBroadcastedRoutes([]);
        return;
      }
      if (payload.type === 'studentId') {
        const newStudentId = typeof payloadBody?.studentId === 'string' ? payloadBody.studentId : null;
        if (!newStudentId) return;
        setStudentId(newStudentId);
        localStorage.setItem(`student-id-${sessionId}`, newStudentId);
      } else if (payload.type === 'problemUpdate') {
        setCities(Array.isArray(payloadBody?.cities) ? (payloadBody.cities as City[]) : []);
        setDistanceMatrix(Array.isArray(payloadBody?.distanceMatrix) ? (payloadBody.distanceMatrix as DistanceMatrix) : []);
        setTerrainSeed(typeof payloadBody?.seed === 'number' ? payloadBody.seed : Date.now());
        // Reset route when new problem is generated
        resetBuiltRoute();
        setHoveredCityId(null);
      } else if (payload.type === 'broadcastUpdate') {
        setBroadcastedRoutes(payloadRoutes);
      } else if (payload.type === 'highlightSolution') {
        if (!payloadBody) {
          setBroadcastedRoutes([]);
          return;
        }
        const route: TspDisplayRoute = {
          id: typeof payloadBody.id === 'string' ? payloadBody.id : 'highlight',
          path: Array.isArray(payloadBody.path) ? (payloadBody.path as string[]) : [],
          type: typeof payloadBody.type === 'string' ? payloadBody.type : 'highlight',
          name: typeof payloadBody.name === 'string' ? payloadBody.name : undefined,
          distance: typeof payloadBody.distance === 'number' ? payloadBody.distance : null,
          timeToComplete: typeof payloadBody.timeToComplete === 'number' ? payloadBody.timeToComplete : null,
        };
        setBroadcastedRoutes([route]);
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

  const handleSessionUpdate = useCallback((data: TspSessionData) => {
    if (data.problem && data.problem.cities) {
      setCities(data.problem.cities);
      setDistanceMatrix(data.problem.distanceMatrix || []);
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
  const handleCityClick = (city: City) => {
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

  const submitRoute = async (route: string[], distance: number, timeToComplete: number | null) => {
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

  const computeSoloAlgorithms = async (startCityOverride: string | null = null, options: ComputeSoloOptions = {}) => {
    if (!cities.length || !distanceMatrix.length) return;
    const { runHeuristic: shouldRunHeuristic = true, runBruteForce: shouldRunBruteForceOption = true } = options;
    const startId = startCityOverride || soloStartCityId;
    const startIndex = getRouteStartIndex(startId);
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

  const handleNameSubmit = (e: FormEvent<HTMLFormElement>) => {
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

  const sortedBroadcastedRoutes = sortRoutesByDistance(broadcastedRoutes);
  const soloDisplayedRoutes = buildSoloDisplayedRoutes(isSoloSession, soloActiveViewId, soloAlgorithms);
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
    terrainSeed: terrainSeed ?? undefined
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
            onBroadcast={undefined}
          />
        </div>
      )}
    </div>
  );
}
