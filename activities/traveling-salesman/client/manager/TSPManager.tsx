import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import { useTspSession } from '../hooks/useTspSession';
import { useRouteBuilder } from '../hooks/useRouteBuilder';
import { useBroadcastToggles } from '../hooks/useBroadcastToggles';
import CityMap from '../components/CityMap';
import Leaderboard from '../components/Leaderboard';
import RouteLegend from '../components/RouteLegend';
import { buildLegendItems, dedupeLegendItems } from '../utils/routeLegend';
import { buildManagerLeaderboardEntries } from '../utils/leaderboardBuilders';
import { generateCities } from '../utils/cityGenerator';
import { buildDistanceMatrix } from '../utils/distanceCalculator';
import { formatDistance } from '../utils/formatters';
import { runBruteForce, runHeuristic } from '../utils/algorithmRunner';
import { buildMapRenderProps } from '../utils/mapRenderConfig';
import type {
  City,
  ManagerLeaderboardEntry,
  TspDisplayRoute,
  TspSessionData,
} from '../utils/tspUtilsTypes';
import './TSPManager.css';

interface BruteForceProgress {
  checked: number
  total: number
}

type BruteForceStatus = 'idle' | 'running' | 'cancelled' | 'complete'

interface RouteSavePayload {
  route: string[]
  distance: number | null
  complete: boolean
  timeToComplete?: number | null
}

type ManagerViewEntry = ManagerLeaderboardEntry | TspDisplayRoute

export function toUiBroadcastIds(broadcastIds: string[]): string[] {
  return broadcastIds.map((id) => (id === 'instructor' ? 'instructor-local' : id))
}

function getRouteStartIndex(route: string[]): number {
  const first = route[0]
  if (!first) return 0
  const raw = first.split('-')[1]
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * TSPManager - Instructor view for managing TSP activity
 * Controls map generation, algorithm computation, and solution broadcasting
 */
export default function TSPManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [numCities, setNumCities] = useState(6);
  const [highlightedSolution, setHighlightedSolution] = useState<TspDisplayRoute | null>(null);
  const [computing, setComputing] = useState(false);
  const [bruteForceProgress, setBruteForceProgress] = useState<BruteForceProgress | null>(null);
  const [bruteForceStatus, setBruteForceStatus] = useState<BruteForceStatus>('idle');
  const [hoveredCityId, setHoveredCityId] = useState<string | null>(null);
  const cancelBruteForceRef = useRef(false);
  const progressSentRef = useRef(0);
  const progressLocalRef = useRef(0);
  const mapTokenRef = useRef(0);
  const mapSeedRef = useRef<number | null>(null);

  const handleSessionUpdate = useCallback((data: TspSessionData) => {
    if (data.problem?.seed && data.problem.seed !== mapSeedRef.current) {
      mapSeedRef.current = data.problem.seed;
      mapTokenRef.current += 1;
    }
  }, []);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/traveling-salesman?sessionId=${sessionId}`;
  }, [sessionId]);

  const {
    broadcastIds,
    broadcastSnapshot,
    setBroadcasts,
    initializeBroadcasts,
    handleBroadcastMessage
  } = useBroadcastToggles({ sessionId });

  const {
    session,
    leaderboard,
    fetchSession,
    fetchLeaderboard,
    connect,
    disconnect
  } = useTspSession({
    sessionId,
    buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    includeLeaderboard: true,
    refreshTypes: [
      'problemUpdate',
      'studentsUpdate',
      'broadcastUpdate',
      'clearBroadcast',
      'algorithmsComputed'
    ],
    onMessage: handleBroadcastMessage,
    onSession: handleSessionUpdate
  });

  useEffect(() => {
    if (!session?.broadcasts) return;
    initializeBroadcasts(session.broadcasts);
  }, [session?.broadcasts, initializeBroadcasts]);

  useEffect(() => {
    if (!sessionId) return undefined;
    connect();
    return () => disconnect();
  }, [sessionId, connect, disconnect]);

  const instructorRouteBuilder = useRouteBuilder({
    cityCount: session?.problem?.cities?.length || 0,
    distanceMatrix: session?.problem?.distanceMatrix || null
  });
  const { hydrateRoute, resetRoute } = instructorRouteBuilder;

  useEffect(() => {
    if (session?.instructor?.route?.length) {
      hydrateRoute({
        route: session.instructor.route,
        complete: Boolean(session.instructor.complete),
        distance: session.instructor.distance ?? null,
        timeToComplete: session.instructor.timeToComplete ?? null
      });
    } else {
      resetRoute();
    }
  }, [
    session?.instructor?.route,
    session?.instructor?.complete,
    session?.instructor?.distance,
    session?.instructor?.timeToComplete,
    hydrateRoute,
    resetRoute
  ]);

  const instructorRoute = instructorRouteBuilder.route;
  const instructorComplete = instructorRouteBuilder.isComplete;
  const instructorCurrentDistance = instructorRouteBuilder.currentDistance;
  const instructorTotalDistance = instructorRouteBuilder.totalDistance;
  const instructorTimeToComplete = instructorRouteBuilder.timeToComplete;
  const instructorDistance = instructorComplete ? instructorTotalDistance : instructorCurrentDistance;

  useEffect(() => {
    if (session?.problem?.numCities) {
      setNumCities(session.problem.numCities);
    }
  }, [session?.problem?.numCities]);

  useEffect(() => {
    if (!highlightedSolution?.id) return;
    if (highlightedSolution.id === 'bruteforce' && session?.algorithms?.bruteForce?.route) {
      setHighlightedSolution({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        path: session.algorithms.bruteForce.route,
        type: 'bruteforce',
        distance: session.algorithms.bruteForce.distance
      });
    }
    if (highlightedSolution.id === 'heuristic' && session?.algorithms?.heuristic?.route) {
      setHighlightedSolution({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        path: session.algorithms.heuristic.route,
        type: 'heuristic',
        distance: session.algorithms.heuristic.distance
      });
    }
  }, [highlightedSolution?.id, session?.algorithms]);

  useEffect(() => {
    if (!broadcastIds.includes('bruteforce')) return;
    if (session?.algorithms?.bruteForce?.computed && session?.algorithms?.bruteForce?.route) {
      fetch(`/api/traveling-salesman/${sessionId}/set-broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasts: broadcastIds })
      }).catch(err => console.error('Failed to refresh broadcasts:', err));
    }
  }, [broadcastIds, session?.algorithms?.bruteForce?.computed, session?.algorithms?.bruteForce?.route, sessionId]);

  useEffect(() => {
    if (!broadcastIds.includes('heuristic')) return;
    if (session?.algorithms?.heuristic?.computed && session?.algorithms?.heuristic?.route) {
      fetch(`/api/traveling-salesman/${sessionId}/set-broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasts: broadcastIds })
      }).catch(err => console.error('Failed to refresh broadcasts:', err));
    }
  }, [broadcastIds, session?.algorithms?.heuristic?.computed, session?.algorithms?.heuristic?.route, sessionId]);

  // Generate new map
  const handleGenerateMap = async () => {
    const seed = Date.now();
    const cities = generateCities(numCities, 700, 500, seed);
    const distanceMatrix = buildDistanceMatrix(cities);

    try {
      if (computing && bruteForceStatus === 'running') {
        cancelBruteForceRef.current = true;
        setBruteForceStatus('cancelled');
        setComputing(false);
      }
      mapSeedRef.current = seed;
      mapTokenRef.current += 1;

      await fetch(`/api/traveling-salesman/${sessionId}/set-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cities, distanceMatrix, seed })
      });

      await fetch(`/api/traveling-salesman/${sessionId}/reset-routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      setBruteForceProgress(null);
      setBruteForceStatus('idle');
      resetRoute();
      await setBroadcasts([]);
      setHighlightedSolution(null);

      // Refresh session
      await fetchSession();
      await fetchLeaderboard();
    } catch (err) {
      console.error('Failed to generate map:', err);
    }
  };

  const computeHeuristic = async () => {
    if (!session?.problem?.cities || !session.problem.distanceMatrix) return;
    try {
      const { cities, distanceMatrix } = session.problem;
      const mapTokenAtStart = mapTokenRef.current;
      const startIndex = getRouteStartIndex(instructorRoute);
      const heuristicResult = runHeuristic({ cities, distanceMatrix, startIndex });

      if (mapTokenRef.current !== mapTokenAtStart) {
        return;
      }

      await fetch(`/api/traveling-salesman/${sessionId}/compute-algorithms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heuristic: {
            ...heuristicResult,
            computeTime: heuristicResult.computeTime
          }
        })
      });

      await fetchSession();
      await fetchLeaderboard();
    } catch (err) {
      console.error('Failed to compute heuristic:', err);
    }
  };

  const computeBruteForce = async () => {
    if (!session?.problem?.cities || !session.problem.distanceMatrix) return;
    setComputing(true);
    cancelBruteForceRef.current = false;
    setBruteForceStatus('running');
    setBruteForceProgress({ checked: 0, total: 0 });
    const mapTokenAtStart = mapTokenRef.current;
    try {
      const { cities, distanceMatrix } = session.problem;
      const startIndex = getRouteStartIndex(instructorRoute);
      const bruteForceResult = await runBruteForce({
        cities,
        distanceMatrix,
        startIndex,
        onProgress: async (checked, total) => {
          const now = performance.now();
          if (now - progressLocalRef.current > 150) {
            progressLocalRef.current = now;
            setBruteForceProgress({ checked, total });
          }

          if (now - progressSentRef.current > 500) {
            progressSentRef.current = now;
            try {
              await fetch(`/api/traveling-salesman/${sessionId}/algorithm-progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  bruteForce: { checked, totalChecks: total, status: 'running' }
                })
              });
            } catch (err) {
              console.warn('Failed to send algorithm progress:', err);
            }
          }
        },
        shouldCancel: () => cancelBruteForceRef.current || mapTokenRef.current !== mapTokenAtStart
      });
      const bruteForceTime = bruteForceResult.computeTime;

      if (mapTokenRef.current !== mapTokenAtStart) {
        setBruteForceStatus('cancelled');
        return;
      }

      setBruteForceStatus(bruteForceResult.cancelled ? 'cancelled' : 'complete');
      setBruteForceProgress({ checked: bruteForceResult.checked, total: bruteForceResult.totalChecks });

      if (bruteForceResult.cancelled) {
        return;
      }

      try {
        await fetch(`/api/traveling-salesman/${sessionId}/algorithm-progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bruteForce: {
              checked: bruteForceResult.checked,
              totalChecks: bruteForceResult.totalChecks,
              status: 'complete'
            }
          })
        });
      } catch (err) {
        console.warn('Failed to send final algorithm progress:', err);
      }

      const bruteForcePayload = {
        ...bruteForceResult,
        distance: Number.isFinite(bruteForceResult.distance) ? bruteForceResult.distance : null,
        computeTime: bruteForceTime
      };

      await fetch(`/api/traveling-salesman/${sessionId}/compute-algorithms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bruteForce: bruteForcePayload
        })
      });

      await fetchSession();
      await fetchLeaderboard();
    } catch (err) {
      console.error('Failed to compute brute force:', err);
    } finally {
      setComputing(false);
    }
  };

  const handleCancelBruteForce = () => {
    cancelBruteForceRef.current = true;
    setBruteForceStatus('cancelled');
  };

  const broadcastInstructorRoute = async (
    route: string[],
    distance: number | null,
    timeToComplete: number | null = null,
  ) => {
    try {
      await fetch(`/api/traveling-salesman/${sessionId}/broadcast-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'instructor',
          name: 'Instructor',
          route,
          distance,
          type: 'instructor',
          timeToComplete
        })
      });
    } catch (err) {
      console.error('Failed to broadcast instructor route:', err);
    }
  };

  const handleInstructorCityClick = (city: City) => {
    if (!session?.problem?.cities || !session?.problem?.distanceMatrix) return;
    if (instructorComplete) return;
    if (instructorRoute.includes(city.id)) return;

    const result = instructorRouteBuilder.addCity(city.id);
    if (!result) return;

    if (result.isComplete) {
      if (broadcastIds.includes('instructor')) {
        broadcastInstructorRoute(result.route, result.totalDistance, result.timeToComplete);
      }
      saveInstructorRoute({
        route: result.route,
        distance: result.totalDistance,
        complete: true,
        timeToComplete: result.timeToComplete,
      });
    } else {
      if (broadcastIds.includes('instructor')) {
        broadcastInstructorRoute(result.route, result.currentDistance, null);
      }
      saveInstructorRoute({
        route: result.route,
        distance: result.currentDistance,
        complete: false,
        timeToComplete: null,
      });
    }
  };

  const saveInstructorRoute = async ({
    route,
    distance,
    complete,
    timeToComplete = null,
  }: RouteSavePayload) => {
    try {
      await fetch(`/api/traveling-salesman/${sessionId}/update-instructor-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route, distance, complete, timeToComplete })
      });
    } catch (err) {
      console.error('Failed to persist instructor route:', err);
    }
  };

  // Broadcast solution
  const handleBroadcast = async (solutionId: string) => {
    try {
      await fetch(`/api/traveling-salesman/${sessionId}/broadcast-solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solutionId })
      });
    } catch (err) {
      console.error('Failed to broadcast solution:', err);
    }
  };

  const resolveRouteForEntry = (entry: ManagerViewEntry | null): TspDisplayRoute | null => {
    if (!entry) return null;
    if (entry.type === 'student') {
      const student = session?.students?.find((s) => s.id === entry.id);
      if (student?.currentRoute?.length) {
        return {
          id: entry.id,
          name: entry.name,
          path: student.currentRoute,
          type: 'student',
          distance: student.routeDistance
        };
      }
      return null;
    }
    if (entry.type === 'instructor') {
      if (entry.id === 'instructor-broadcast' && session?.instructor?.route?.length) {
        return {
          id: 'instructor-broadcast',
          name: 'Instructor Broadcast',
          path: session.instructor.route,
          type: 'instructor',
          distance: session.instructor.distance
        };
      }
      if (instructorRoute.length > 0) {
        return {
          id: 'instructor-local',
          name: 'Instructor Route',
          path: instructorRoute,
          type: 'instructor',
          distance: instructorDistance
        };
      }
      return null;
    }
    if (entry.type === 'bruteforce' && session?.algorithms?.bruteForce?.route) {
      return {
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        path: session.algorithms.bruteForce.route,
        type: 'bruteforce',
        distance: session.algorithms.bruteForce.distance
      };
    }
    if (entry.type === 'heuristic' && session?.algorithms?.heuristic?.route) {
      return {
        id: 'heuristic',
        name: 'Nearest Neighbor',
        path: session.algorithms.heuristic.route,
        type: 'heuristic',
        distance: session.algorithms.heuristic.distance
      };
    }
    if ('path' in entry && Array.isArray(entry.path)) {
      return entry
    }
    return null;
  };

  const handleAlgorithmClick = (entry: ManagerLeaderboardEntry) => {
    if (entry.type === 'bruteforce') {
      if (computing && bruteForceStatus === 'running') {
        handleCancelBruteForce();
      } else {
        computeBruteForce();
      }
      return;
    }
    if (entry.type === 'heuristic') {
      computeHeuristic();
    }
  };

  const viewAlgorithmWhenReady = async (entry: ManagerLeaderboardEntry) => {
    setHighlightedSolution({
      id: entry.id,
      name: entry.name,
      path: undefined,
      type: entry.type,
      distance: null
    });
    if (entry.type === 'bruteforce') {
      if (!session?.algorithms?.bruteForce?.route && !(computing && bruteForceStatus === 'running')) {
        await computeBruteForce();
      }
      const route = session?.algorithms?.bruteForce?.route;
      if (route) {
        setHighlightedSolution({
          id: 'bruteforce',
          name: 'Brute Force (Optimal)',
          path: route,
          type: 'bruteforce',
          distance: session.algorithms?.bruteForce?.distance ?? null
        });
      }
      return;
    }
    if (entry.type === 'heuristic') {
      if (!session?.algorithms?.heuristic?.route) {
        await computeHeuristic();
      }
      const route = session?.algorithms?.heuristic?.route;
      if (route) {
        setHighlightedSolution({
          id: 'heuristic',
          name: 'Nearest Neighbor',
          path: route,
          type: 'heuristic',
          distance: session.algorithms?.heuristic?.distance ?? null
        });
      }
    }
  };

  const handleToggleBroadcast = async (entry: ManagerLeaderboardEntry) => {
    try {
      const broadcastId = entry.id === 'instructor-local' ? 'instructor' : entry.id;
      const isOn = broadcastIds.includes(broadcastId);

      if (!isOn) {
        if (entry.type === 'student' && (!session?.students?.find((s) => s.id === entry.id)?.currentRoute?.length)) {
          return;
        }
        if (entry.id === 'instructor' && (!session?.problem?.distanceMatrix || instructorRoute.length === 0)) {
          return;
        }
      }

      const next = isOn
        ? broadcastIds.filter(id => id !== broadcastId)
        : [...broadcastIds, broadcastId];

      await setBroadcasts(next);

      if (!isOn && entry.type === 'heuristic' && !session?.algorithms?.heuristic?.computed) {
        await computeHeuristic();
      }
      if (!isOn && entry.type === 'bruteforce' && !session?.algorithms?.bruteForce?.computed && bruteForceStatus !== 'running') {
        await computeBruteForce();
      }
      if (!isOn && entry.id === 'instructor') {
        const totalDistance = instructorComplete
          ? instructorTotalDistance
          : instructorCurrentDistance;
        const timeToComplete = instructorComplete ? instructorTimeToComplete : null;
        await broadcastInstructorRoute(instructorRoute, totalDistance, timeToComplete);
      }
    } catch (err) {
      console.error('Failed to toggle broadcast:', err);
    }
  };

  const handleResetInstructorRoute = () => {
    resetRoute();
    if (highlightedSolution?.id === 'instructor' || highlightedSolution?.id === 'instructor-local') {
      setHighlightedSolution(null);
    }
    if (broadcastIds.includes('instructor')) {
      const next = broadcastIds.filter(id => id !== 'instructor');
      setBroadcasts(next).catch(err => console.error('Failed to update broadcasts:', err));
    }
    fetch(`/api/traveling-salesman/${sessionId}/reset-instructor-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(err => console.error('Failed to reset instructor route:', err));
    fetch(`/api/traveling-salesman/${sessionId}/reset-heuristic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(() => Promise.all([fetchSession(), fetchLeaderboard()]))
      .catch(err => console.error('Failed to reset heuristic route:', err));
  };

  // End session
  const handleEndSession = async () => {
    try {
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
      navigate('/manage');
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  // Get all routes for visualization
  const getAllRoutes = () => {
    const routes: TspDisplayRoute[] = [];

    if (broadcastSnapshot.length > 0) {
      broadcastSnapshot.forEach((route) => {
        if (!route?.path?.length) return;
        routes.push({
          id: route.id,
          path: route.path,
          type: route.type
        });
      });
    } else {
      if (broadcastIds.includes('bruteforce') && session?.algorithms?.bruteForce?.route) {
        routes.push({
          id: 'bruteforce',
          path: session.algorithms.bruteForce.route,
          type: 'bruteforce'
        });
      }

      if (broadcastIds.includes('heuristic') && session?.algorithms?.heuristic?.route) {
        routes.push({
          id: 'heuristic',
          path: session.algorithms.heuristic.route,
          type: 'heuristic'
        });
      }

      if (broadcastIds.includes('instructor') && session?.instructor?.route?.length) {
        routes.push({
          id: 'instructor-broadcast',
          path: session.instructor.route,
          type: 'instructor'
        });
      }

      if (session?.students?.length) {
        session.students.forEach((student) => {
          if (broadcastIds.includes(student.id) && student.currentRoute?.length) {
            routes.push({
              id: student.id,
              path: student.currentRoute,
              type: 'student'
            });
          }
        });
      }
    }

    if (instructorRoute.length > 0) {
      routes.push({
        id: 'instructor-local',
        path: instructorRoute,
        type: 'instructor'
      });
    }

    // Add highlighted solution last so it draws on top
    if (highlightedSolution) {
      const resolved = resolveRouteForEntry(highlightedSolution);
      if (resolved) routes.push(resolved);
    }

    return routes;
  };

  const displayLeaderboard = useMemo(() => {
    return buildManagerLeaderboardEntries({
      leaderboard,
      instructorRoute,
      instructorDistance,
      instructorComplete,
      instructorTimeToComplete,
      bruteForceStatus,
      bruteForceProgress,
      cityCount: session?.problem?.cities?.length ?? null
    });
  }, [
    leaderboard,
    instructorRoute,
    instructorDistance,
    instructorComplete,
    instructorTimeToComplete,
    bruteForceStatus,
    bruteForceProgress,
    session?.problem?.cities?.length
  ]);

  const legendItems = useMemo(() => {
    const primary = instructorRoute.length > 0
      ? {
        id: 'instructor-local',
        type: 'instructor',
        label: 'Instructor Route',
        distance: instructorDistance
      }
      : null;
    const routes: TspDisplayRoute[] = [];
    if (broadcastIds.includes('bruteforce') && session?.algorithms?.bruteForce?.route) {
      routes.push({
        id: 'bruteforce',
        type: 'bruteforce',
        label: 'Brute Force (Optimal)',
        distance: session.algorithms.bruteForce.distance ?? null,
        progressCurrent: session.algorithms.bruteForce.progressCurrent ?? null,
        progressTotal: session.algorithms.bruteForce.progressTotal ?? null
      });
    }
    if (broadcastIds.includes('heuristic') && session?.algorithms?.heuristic?.route) {
      routes.push({
        id: 'heuristic',
        type: 'heuristic',
        label: 'Nearest Neighbor',
        distance: session.algorithms.heuristic.distance ?? null
      });
    }
    if (broadcastIds.includes('instructor') && session?.instructor?.route?.length) {
      routes.push({
        id: 'instructor-broadcast',
        type: 'instructor',
        label: 'Instructor Broadcast',
        distance: session.instructor.distance ?? null
      });
    }
    if (session?.students?.length) {
      session.students.forEach((student) => {
        if (broadcastIds.includes(student.id) && student.currentRoute?.length) {
          routes.push({
            id: student.id,
            type: 'student',
            label: student.name,
            distance: student.routeDistance ?? null
          });
        }
      });
    }
    if (highlightedSolution) {
      const resolved = resolveRouteForEntry(highlightedSolution);
      if (resolved) {
        routes.push({
          id: resolved.id,
          type: 'highlight',
          label: resolved.name || 'Selected Route',
          distance: resolved.distance ?? null,
          progressCurrent: resolved.progressCurrent ?? null,
          progressTotal: resolved.progressTotal ?? null
        });
      }
    }
    const items = buildLegendItems({ primary, routes });
    const hasInstructorLocal = items.some(item => item.id === 'instructor-local');
    const filtered = hasInstructorLocal
      ? items.filter(item => item.id !== 'instructor-broadcast')
      : items;
    return dedupeLegendItems(filtered);
  }, [instructorRoute.length, instructorDistance, highlightedSolution, broadcastIds, session?.algorithms, session?.instructor, session?.students]);

  const uiBroadcastIds = useMemo(() => {
    return toUiBroadcastIds(broadcastIds);
  }, [broadcastIds]);

  const mapRenderProps = buildMapRenderProps({
    activeRoute: instructorRoute,
    hoverRoute: instructorRoute,
    hoveredCityId,
    terrainSeed: session?.problem?.seed ?? undefined
  });

  return (
    <div className="tsp-manager">
      <SessionHeader
        activityName="Traveling Salesman"
        sessionId={sessionId}
        onEndSession={handleEndSession}
      />

      <div className="manager-content">
        <div className="visualization-section">
          <div className="manager-map-stack">
            <div className="map-row">
              <div className="map-side">
                <div className="map-setup-panel">
                  <h3>Map Setup</h3>
                  <div className="control-group">
                    <label>
                      Number of Cities:
                      <select
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
                    <Button onClick={handleGenerateMap}>Generate Map</Button>
                  </div>
                </div>
                {instructorRoute.length > 0 && (
                  <div className="instructor-controls">
                    <div className="info-line">
                      Instructor route progress: {instructorRoute.length}/{session?.problem?.cities?.length || 0}
                    </div>
                    <div className="info-line">
                      {instructorComplete ? 'Total distance' : 'Current distance'}: {formatDistance(instructorDistance)}
                    </div>
                    <Button onClick={handleResetInstructorRoute}>
                      Reset Route
                    </Button>
                  </div>
                )}
              </div>
              {session?.problem?.cities ? (
                <CityMap
                  cities={session.problem.cities}
                  routes={getAllRoutes()}
                  highlightedRoute={highlightedSolution}
                  onCityClick={handleInstructorCityClick}
                  onCityHover={(city) => setHoveredCityId(city.id)}
                  onCityLeave={() => setHoveredCityId(null)}
                  distanceMatrix={session.problem.distanceMatrix}
                  {...mapRenderProps}
                />
              ) : (
                <div className="no-map">
                  <p>Click "Generate Map" to start</p>
                </div>
              )}
              {legendItems.length > 0 && (
                <RouteLegend title="Legend" items={legendItems} />
              )}
            </div>
          </div>
        </div>

        <div className="leaderboard-section">
          <Leaderboard
            entries={displayLeaderboard}
            onHighlight={(entry) => {
              if (entry.type === 'bruteforce' || entry.type === 'heuristic') {
                if (highlightedSolution?.id === entry.id) {
                  setHighlightedSolution(null);
                } else {
                  viewAlgorithmWhenReady(entry);
                }
                return;
              }
              const resolved = resolveRouteForEntry(entry);
              setHighlightedSolution((current) => (current?.id === entry.id ? null : (resolved || entry)));
            }}
            onBroadcast={handleBroadcast}
            onToggleBroadcast={handleToggleBroadcast}
            broadcastIds={uiBroadcastIds}
            onNameClick={handleAlgorithmClick}
            activeViewId={highlightedSolution?.id || null}
          />
        </div>
      </div>
    </div>
  );
}
