import { useCallback, useState } from 'react';
import { getRouteDistance, isRouteComplete } from '../utils/distanceCalculator.js';

export function useRouteBuilder({
  cityCount = 0,
  distanceMatrix = null,
  onProgress,
  onComplete
} = {}) {
  const [route, setRoute] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [currentDistance, setCurrentDistance] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [timeToComplete, setTimeToComplete] = useState(null);

  const resetRoute = useCallback(() => {
    setRoute([]);
    setIsComplete(false);
    setStartTime(null);
    setCurrentDistance(0);
    setTotalDistance(0);
    setTimeToComplete(null);
  }, []);

  const hydrateRoute = useCallback(({
    route: nextRoute = [],
    complete = false,
    distance = null,
    timeToComplete: nextTimeToComplete = null
  } = {}) => {
    setRoute(Array.isArray(nextRoute) ? nextRoute : []);
    setIsComplete(Boolean(complete));
    setTimeToComplete(nextTimeToComplete ?? null);
    if (!Array.isArray(nextRoute) || nextRoute.length === 0) {
      setCurrentDistance(0);
      setTotalDistance(0);
      return;
    }
    if (complete) {
      const total = Number.isFinite(distance)
        ? distance
        : getRouteDistance(nextRoute, distanceMatrix, true);
      setTotalDistance(total || 0);
      setCurrentDistance(total || 0);
    } else {
      const current = Number.isFinite(distance)
        ? distance
        : getRouteDistance(nextRoute, distanceMatrix, false);
      setCurrentDistance(current || 0);
      setTotalDistance(0);
    }
  }, [distanceMatrix]);

  const addCity = useCallback((cityId) => {
    if (isComplete) return null;
    if (!cityId) return null;
    if (route.includes(cityId)) return null;

    const now = Date.now();
    const nextStartTime = startTime ?? now;
    if (startTime === null) {
      setStartTime(nextStartTime);
    }

    const nextRoute = [...route, cityId];
    const complete = isRouteComplete(nextRoute, cityCount);
    const current = getRouteDistance(nextRoute, distanceMatrix, false);
    setRoute(nextRoute);
    setCurrentDistance(current);

    if (complete) {
      const total = getRouteDistance(nextRoute, distanceMatrix, true);
      const completionTime = Math.floor((Date.now() - nextStartTime) / 1000);
      setIsComplete(true);
      setTotalDistance(total);
      setCurrentDistance(total);
      setTimeToComplete(completionTime);
      onComplete?.({
        route: nextRoute,
        distance: total,
        timeToComplete: completionTime
      });
      return {
        route: nextRoute,
        isComplete: true,
        currentDistance: total,
        totalDistance: total,
        timeToComplete: completionTime
      };
    }

    onProgress?.({
      route: nextRoute,
      currentDistance: current
    });
    return {
      route: nextRoute,
      isComplete: false,
      currentDistance: current,
      totalDistance: 0,
      timeToComplete: null
    };
  }, [isComplete, route, startTime, cityCount, distanceMatrix, onComplete, onProgress]);

  return {
    route,
    isComplete,
    startTime,
    currentDistance,
    totalDistance,
    timeToComplete,
    setRoute,
    setIsComplete,
    setStartTime,
    setCurrentDistance,
    setTotalDistance,
    setTimeToComplete,
    resetRoute,
    hydrateRoute,
    addCity
  };
}

