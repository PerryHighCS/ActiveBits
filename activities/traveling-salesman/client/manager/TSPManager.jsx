import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import CityMap from '../components/CityMap.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import RouteLegend from '../components/RouteLegend.jsx';
import { generateCities } from '../utils/cityGenerator.js';
import { buildDistanceMatrix, calculateCurrentDistance, calculateTotalDistance } from '../utils/distanceCalculator.js';
import { solveTSPBruteForce } from '../utils/bruteForce.js';
import { solveTSPNearestNeighbor } from '../utils/nearestNeighbor.js';
import './TSPManager.css';

/**
 * TSPManager - Instructor view for managing TSP activity
 * Controls map generation, algorithm computation, and solution broadcasting
 */
export default function TSPManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [numCities, setNumCities] = useState(6);
  const [highlightedSolution, setHighlightedSolution] = useState(null);
  const [computing, setComputing] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [bruteForceProgress, setBruteForceProgress] = useState(null);
  const [bruteForceStatus, setBruteForceStatus] = useState('idle');
  const [instructorRoute, setInstructorRoute] = useState([]);
  const [instructorDistance, setInstructorDistance] = useState(0);
  const [instructorComplete, setInstructorComplete] = useState(false);
  const [instructorStartTime, setInstructorStartTime] = useState(null);
  const [instructorTimeToComplete, setInstructorTimeToComplete] = useState(null);
  const [hoveredCityId, setHoveredCityId] = useState(null);
  const [broadcastIds, setBroadcastIds] = useState([]);
  const cancelBruteForceRef = useRef(false);
  const progressSentRef = useRef(0);
  const progressLocalRef = useRef(0);
  const refreshTimeoutRef = useRef(null);
  const mapTokenRef = useRef(0);
  const mapSeedRef = useRef(null);
  const pendingBroadcastRef = useRef(null);

  // Fetch session state
  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`);
      if (!res.ok) throw new Error('Failed to fetch session');
      const data = await res.json();
      setSession(data);
      if (data?.problem?.seed && data.problem.seed !== mapSeedRef.current) {
        mapSeedRef.current = data.problem.seed;
        mapTokenRef.current += 1;
      }
      if (data.instructor?.route?.length) {
        setInstructorRoute(data.instructor.route);
        setInstructorDistance(data.instructor.distance ?? 0);
        setInstructorComplete(Boolean(data.instructor.complete));
        setInstructorTimeToComplete(data.instructor.timeToComplete ?? null);
      } else {
        setInstructorRoute([]);
        setInstructorDistance(0);
        setInstructorComplete(false);
        setInstructorStartTime(null);
        setInstructorTimeToComplete(null);
      }
    } catch (err) {
      console.error('Failed to fetch session:', err);
    }
  }, [sessionId]);

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/leaderboard`);
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    }
  }, [sessionId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      fetchSession();
      fetchLeaderboard();
    }, 100);
  }, [fetchSession, fetchLeaderboard]);

  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      if ([
        'problemUpdate',
        'studentsUpdate',
        'broadcastUpdate',
        'clearBroadcast',
        'algorithmsComputed'
      ].includes(message.type)) {
        scheduleRefresh();
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, [scheduleRefresh]);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/traveling-salesman?sessionId=${sessionId}`;
  }, [sessionId]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onOpen: () => {
      fetchSession();
      fetchLeaderboard();
    },
    onMessage: handleWsMessage
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    connect();
    return () => disconnect();
  }, [sessionId, connect, disconnect]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (session?.problem?.numCities) {
      setNumCities(session.problem.numCities);
    }
  }, [session?.problem?.numCities]);

  useEffect(() => {
    if (session?.broadcasts) {
      const next = session.broadcasts;
      const pending = pendingBroadcastRef.current;
      if (pending) {
        const isSame = pending.next.length === next.length
          && pending.next.every((id, idx) => id === next[idx]);
        if (isSame) {
          pendingBroadcastRef.current = null;
          setBroadcastIds(next);
          return;
        }
        if (Date.now() - pending.at < 1000) {
          return;
        }
        pendingBroadcastRef.current = null;
      }
      setBroadcastIds(next);
    }
  }, [session?.broadcasts]);

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
      setInstructorRoute([]);
      setInstructorDistance(0);
      setInstructorComplete(false);
      setInstructorStartTime(null);
      setInstructorTimeToComplete(null);
      setBroadcastIds([]);
      setHighlightedSolution(null);

      // Refresh session
      await fetchSession();
      await fetchLeaderboard();
    } catch (err) {
      console.error('Failed to generate map:', err);
    }
  };

  const computeHeuristic = async () => {
    if (!session?.problem?.cities) return;
    try {
      const { cities, distanceMatrix } = session.problem;
      const mapTokenAtStart = mapTokenRef.current;
      const startIndex = instructorRoute.length > 0
        ? parseInt(instructorRoute[0].split('-')[1], 10)
        : 0;
      const heuristicStart = performance.now();
      const heuristicResult = solveTSPNearestNeighbor(cities, distanceMatrix, { startIndex });
      const heuristicEnd = performance.now();
      const heuristicTime = Number(((heuristicEnd - heuristicStart) / 1000).toFixed(3));

      if (mapTokenRef.current !== mapTokenAtStart) {
        return;
      }

      await fetch(`/api/traveling-salesman/${sessionId}/compute-algorithms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heuristic: {
            ...heuristicResult,
            computeTime: heuristicTime
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
    if (!session?.problem?.cities) return;
    setComputing(true);
    cancelBruteForceRef.current = false;
    setBruteForceStatus('running');
    setBruteForceProgress({ checked: 0, total: 0 });
    const mapTokenAtStart = mapTokenRef.current;
    try {
      const { cities, distanceMatrix } = session.problem;
      const bruteForceStart = performance.now();
      const bruteForceResult = await solveTSPBruteForce(cities, distanceMatrix, {
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
      const bruteForceEnd = performance.now();
      const bruteForceTime = bruteForceResult.cancelled
        ? null
        : Number(((bruteForceEnd - bruteForceStart) / 1000).toFixed(3));

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

  const broadcastInstructorRoute = async (route, distance, timeToComplete = null) => {
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

  const handleInstructorCityClick = (city) => {
    if (!session?.problem?.cities || !session?.problem?.distanceMatrix) return;
    if (instructorComplete) return;
    if (instructorRoute.includes(city.id)) return;

    const now = Date.now();
    const startTime = instructorStartTime ?? now;
    if (instructorStartTime === null) {
      setInstructorStartTime(startTime);
    }

    const newRoute = [...instructorRoute, city.id];
    const isComplete = newRoute.length === session.problem.cities.length;
    const currentDistance = calculateCurrentDistance(newRoute, session.problem.distanceMatrix);

    setInstructorRoute(newRoute);
    setInstructorDistance(currentDistance);

    if (isComplete) {
      const totalDistance = calculateTotalDistance(newRoute, session.problem.distanceMatrix);
      const completionTime = Math.floor((Date.now() - startTime) / 1000);
      setInstructorComplete(true);
      setInstructorDistance(totalDistance);
      setInstructorTimeToComplete(completionTime);
      if (broadcastIds.includes('instructor')) {
        broadcastInstructorRoute(newRoute, totalDistance, completionTime);
      }
      saveInstructorRoute(newRoute, totalDistance, true, completionTime);
    } else if (broadcastIds.includes('instructor')) {
      broadcastInstructorRoute(newRoute, currentDistance, null);
    }
    if (!isComplete) {
      saveInstructorRoute(newRoute, currentDistance, false, null);
    }
  };

  const saveInstructorRoute = async (route, distance, complete, timeToComplete = null) => {
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
  const handleBroadcast = async (solutionId) => {
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

  const resolveRouteForEntry = (entry) => {
    if (!entry) return null;
    if (entry.type === 'student') {
      const student = session?.students?.find(s => s.id === entry.id);
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
    return entry.path ? entry : null;
  };

  const handleAlgorithmClick = (entry) => {
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

  const viewAlgorithmWhenReady = async (entry) => {
    setHighlightedSolution({
      id: entry.id,
      name: entry.name,
      path: null,
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
          distance: session.algorithms.bruteForce.distance
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
          distance: session.algorithms.heuristic.distance
        });
      }
    }
  };

  const handleToggleBroadcast = async (entry) => {
    try {
      const broadcastId = entry.id === 'instructor-local' ? 'instructor' : entry.id;
      const isOn = broadcastIds.includes(broadcastId);

      if (!isOn && entry.type === 'heuristic' && !session?.algorithms?.heuristic?.computed) {
        await computeHeuristic();
      }
      if (!isOn && entry.type === 'bruteforce' && !session?.algorithms?.bruteForce?.computed && bruteForceStatus !== 'running') {
        await computeBruteForce();
      }
      if (!isOn && entry.id === 'instructor') {
        if (!session?.problem?.distanceMatrix || instructorRoute.length === 0) return;
        const totalDistance = instructorRoute.length === session.problem.cities.length
          ? calculateTotalDistance(instructorRoute, session.problem.distanceMatrix)
          : instructorDistance;
        const timeToComplete = instructorComplete
          ? instructorTimeToComplete
          : null;
        await broadcastInstructorRoute(instructorRoute, totalDistance, timeToComplete);
      }

      if (!isOn && entry.type === 'student' && (!session?.students?.find(s => s.id === entry.id)?.currentRoute?.length)) {
        return;
      }

      const next = isOn
        ? broadcastIds.filter(id => id !== broadcastId)
        : [...broadcastIds, broadcastId];

      setBroadcastIds(next);
      pendingBroadcastRef.current = { next, at: Date.now() };
      await fetch(`/api/traveling-salesman/${sessionId}/set-broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasts: next })
      });
    } catch (err) {
      console.error('Failed to toggle broadcast:', err);
    }
  };

  const handleResetInstructorRoute = () => {
    setInstructorRoute([]);
    setInstructorDistance(0);
    setInstructorComplete(false);
    setInstructorStartTime(null);
    setInstructorTimeToComplete(null);
    if (highlightedSolution?.id === 'instructor' || highlightedSolution?.id === 'instructor-local') {
      setHighlightedSolution(null);
    }
    if (broadcastIds.includes('instructor')) {
      const next = broadcastIds.filter(id => id !== 'instructor');
      setBroadcastIds(next);
      fetch(`/api/traveling-salesman/${sessionId}/set-broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasts: next })
      }).catch(err => console.error('Failed to update broadcasts:', err));
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
    const routes = [];

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
      session.students.forEach(student => {
        if (broadcastIds.includes(student.id) && student.currentRoute?.length) {
          routes.push({
            id: student.id,
            path: student.currentRoute,
            type: 'student'
          });
        }
      });
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
    const entries = [...leaderboard];
    if (instructorRoute.length > 0) {
      const existingIndex = entries.findIndex(entry => entry.id === 'instructor');
      const entry = {
        id: 'instructor-local',
        name: 'Instructor',
        distance: instructorRoute.length > 0 ? instructorDistance : null,
        timeToComplete: instructorComplete
          ? instructorTimeToComplete
          : null,
        progressCurrent: instructorRoute.length,
        progressTotal: session?.problem?.cities?.length ?? null,
        type: 'instructor',
        complete: instructorComplete
      };
      if (existingIndex >= 0) {
        entries[existingIndex] = { ...entries[existingIndex], ...entry };
      } else {
        entries.push(entry);
      }
    }
    if (!entries.find(entry => entry.id === 'bruteforce')) {
      entries.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: null,
        timeToComplete: null,
        progressCurrent: null,
        progressTotal: null,
        type: 'bruteforce',
        complete: false
      });
    }
    if (!entries.find(entry => entry.id === 'heuristic')) {
      entries.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: null,
        timeToComplete: null,
        progressCurrent: null,
        progressTotal: null,
        type: 'heuristic',
        complete: false
      });
    }
    if (bruteForceStatus === 'running' || bruteForceStatus === 'cancelled') {
      const existingIndex = entries.findIndex(entry => entry.id === 'bruteforce');
      const entry = {
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: null,
        timeToComplete: null,
        progressCurrent: bruteForceProgress?.checked ?? null,
        progressTotal: bruteForceProgress?.total ?? null,
        type: 'bruteforce',
        complete: false
      };
      if (existingIndex >= 0) {
        entries[existingIndex] = { ...entries[existingIndex], ...entry };
      } else {
        entries.push(entry);
      }
    }
    entries.sort((a, b) => {
      const aComplete = a.complete === true;
      const bComplete = b.complete === true;
      if (aComplete && !bComplete) return -1;
      if (!aComplete && bComplete) return 1;
      const aDistance = a.distance ?? Infinity;
      const bDistance = b.distance ?? Infinity;
      return aDistance - bDistance;
    });
    return entries;
  }, [leaderboard, bruteForceStatus, bruteForceProgress, instructorRoute.length, instructorDistance, instructorComplete, session?.problem?.cities?.length]);

  const legendItems = useMemo(() => {
    const items = [];
    if (instructorRoute.length > 0) {
      items.push({
        id: 'instructor-local',
        type: 'instructor',
        label: 'Instructor Route',
        distance: instructorDistance
      });
    }
    if (broadcastIds.includes('bruteforce') && session?.algorithms?.bruteForce?.route) {
      items.push({
        id: 'bruteforce',
        type: 'bruteforce',
        label: 'Brute Force (Optimal)',
        distance: session.algorithms.bruteForce.distance ?? null,
        progressCurrent: session.algorithms.bruteForce.progressCurrent ?? null,
        progressTotal: session.algorithms.bruteForce.progressTotal ?? null
      });
    }
    if (broadcastIds.includes('heuristic') && session?.algorithms?.heuristic?.route) {
      items.push({
        id: 'heuristic',
        type: 'heuristic',
        label: 'Nearest Neighbor',
        distance: session.algorithms.heuristic.distance ?? null
      });
    }
    if (broadcastIds.includes('instructor') && session?.instructor?.route?.length) {
      items.push({
        id: 'instructor-broadcast',
        type: 'instructor',
        label: 'Instructor Broadcast',
        distance: session.instructor.distance ?? null
      });
    }
    if (session?.students?.length) {
      session.students.forEach(student => {
        if (broadcastIds.includes(student.id) && student.currentRoute?.length) {
          items.push({
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
        items.push({
          id: resolved.id,
          type: 'highlight',
          label: resolved.name || 'Selected Route',
          distance: resolved.distance ?? null,
          progressCurrent: resolved.progressCurrent ?? null,
          progressTotal: resolved.progressTotal ?? null
        });
      }
    }
    const hasInstructorLocal = items.some(item => item.id === 'instructor-local');
    const filtered = hasInstructorLocal
      ? items.filter(item => item.id !== 'instructor-broadcast')
      : items;
    const byId = new Map();
    filtered.forEach((item) => {
      byId.set(item.id, item);
    });
    return Array.from(byId.values());
  }, [instructorRoute.length, instructorDistance, highlightedSolution, broadcastIds, session?.algorithms, session?.instructor, session?.students]);

  const uiBroadcastIds = useMemo(() => {
    return broadcastIds.map(id => (id === 'instructor' ? 'instructor-local' : id));
  }, [broadcastIds]);

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
                      {instructorComplete ? 'Total distance' : 'Current distance'}: {instructorDistance.toFixed(1)}
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
                  activeRoute={instructorRoute}
                  hoverRoute={instructorRoute}
                  hoveredCityId={hoveredCityId}
                  terrainSeed={session.problem.seed}
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
