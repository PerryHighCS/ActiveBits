import React from 'react';
import ProgressBar from './ProgressBar.jsx';
import './RouteLegend.css';

export default function RouteLegend({ title = 'Viewing', items = [] }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="route-legend">
      <div className="route-legend-title">{title}</div>
      {items.map((item) => (
        <div key={item.id} className={`route-legend-item ${item.type}`}>
          <span className="route-legend-swatch" />
          <span className="route-legend-label">
            {item.label}
            {item.distance !== null && item.distance !== undefined
              ? ` (${item.distance.toFixed(1)})`
              : (item.progressCurrent !== null && item.progressCurrent !== undefined
                && item.progressTotal !== null && item.progressTotal !== undefined
                ? ` (${item.progressCurrent}/${item.progressTotal})`
                : '')}
          </span>
        </div>
      ))}
      {items.some(item => item.type === 'bruteforce'
        && item.progressCurrent !== null && item.progressCurrent !== undefined
        && item.progressTotal !== null && item.progressTotal !== undefined
        && item.progressTotal !== item.progressCurrent ) && (
        <ProgressBar
          value={items.find(item => item.type === 'bruteforce')?.progressCurrent || 0}
          max={items.find(item => item.type === 'bruteforce')?.progressTotal || 0}
          label={`Brute force checks: ${items.find(item => item.type === 'bruteforce')?.progressCurrent || 0}/${items.find(item => item.type === 'bruteforce')?.progressTotal || 0}`}
        />
      )}
    </div>
  );
}
