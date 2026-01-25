import React from 'react';
import ProgressBar from './ProgressBar.jsx';
import './RouteLegend.css';
import { ROUTE_TYPES } from '../utils/routeTypes.js';
import { formatDistance } from '../utils/formatters.js';
import { getProgressLabel } from '../utils/progressHelpers.js';

export default function RouteLegend({ title = 'Viewing', items = [] }) {
  if (!items || items.length === 0) return null;
  const bruteForceItem = items.find(item => item.type === 'bruteforce');
  const showBruteForceProgress = bruteForceItem
    && bruteForceItem.progressCurrent !== null
    && bruteForceItem.progressCurrent !== undefined
    && bruteForceItem.progressTotal !== null
    && bruteForceItem.progressTotal !== undefined
    && bruteForceItem.progressTotal !== bruteForceItem.progressCurrent;

  return (
    <div className="route-legend">
      <div className="route-legend-title">{title}</div>
      {items.map((item) => (
        <div key={item.id} className={`route-legend-item ${item.type}`}>
          <span
            className="route-legend-swatch"
            style={{ background: ROUTE_TYPES[item.type]?.color }}
          />
          <span className="route-legend-label">
            {item.label}
            {item.distance !== null && item.distance !== undefined
              ? ` (${formatDistance(item.distance)})`
              : ''}
          </span>
        </div>
      ))}
      {showBruteForceProgress && (
        <ProgressBar
          value={bruteForceItem?.progressCurrent || 0}
          max={bruteForceItem?.progressTotal || 0}
          label={`Brute force checks: ${getProgressLabel(bruteForceItem?.progressCurrent || 0, bruteForceItem?.progressTotal || 0)}`}
        />
      )}
    </div>
  );
}
