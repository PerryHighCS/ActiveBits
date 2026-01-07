import React from 'react';

export default function TriangleNav({ onNavigate, disabled = true, disabledButtons = {} }) {
  const handleClick = (direction) => {
    if (!disabled && onNavigate) {
      onNavigate(direction);
    }
  };

  // Colors from CSS variables
  const glowColor = '#6ff0ff';
  const accentColor = '#7df2c9';
  const warnColor = '#ffb347';
  const fillColor = 'rgba(111, 240, 255, 0.2)';
  const fillColorCenter = 'rgba(255, 179, 71, 0.25)';
  
  const size = 280;
  const padding = 20;
  
  // Center upright triangle (main focus)
  const centerTop = { x: size / 2, y: padding };
  const centerLeft = { x: padding, y: size - padding };
  const centerRight = { x: size - padding, y: size - padding };

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const normalize = (v) => {
    const len = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / len, y: v.y / len };
  };
  
  // Helper to extend a line from a point through another point
  const extendLine = (from, through, distance) => {
    const dx = through.x - from.x;
    const dy = through.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / len;
    const ny = dy / len;
    return {
      x: through.x + nx * distance,
      y: through.y + ny * distance
    };
  };
  
  // Helper to shrink a point toward a center
  const shrinkPoint = (point, center, factor) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor
  });
  
  const baseLength = distance(centerLeft, centerRight);
  const halfSide = baseLength / 2;
  const extLen = baseLength / 4; // half of midpoint span
  const dirLeftEdge = normalize({ x: centerLeft.x - centerTop.x, y: centerLeft.y - centerTop.y });
  const dirRightEdge = normalize({ x: centerRight.x - centerTop.x, y: centerRight.y - centerTop.y });
  const dirBase = normalize({ x: centerRight.x - centerLeft.x, y: centerRight.y - centerLeft.y });

  // Guide endpoints (length = extLen)
  // Top: one leg along triangle edge, one horizontal through the tip
  const topUpExtend = { x: centerTop.x, y: centerTop.y - extLen };
  const topLeftExtend = { x: centerTop.x - dirLeftEdge.x * extLen, y: centerTop.y - dirLeftEdge.y * extLen };
  const topRightExtend = { x: centerTop.x - dirRightEdge.x * extLen, y: centerTop.y - dirRightEdge.y * extLen };
  const topHorizLeft = { x: centerTop.x - extLen, y: centerTop.y };
  const topHorizRight = { x: centerTop.x + extLen, y: centerTop.y };

  // Bottom: horizontal base extension and angled extensions continuing the sides
  const leftBaseExtend = { x: centerLeft.x - dirBase.x * extLen, y: centerLeft.y - dirBase.y * extLen };
  const rightBaseExtend = { x: centerRight.x + dirBase.x * extLen, y: centerRight.y + dirBase.y * extLen };
  const leftDownExtend = { x: centerLeft.x + dirLeftEdge.x * extLen, y: centerLeft.y + dirLeftEdge.y * extLen };
  const rightDownExtend = { x: centerRight.x + dirRightEdge.x * extLen, y: centerRight.y + dirRightEdge.y * extLen };

  // Larger outer navigation triangles constructed from guide endpoints
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const outwardPoint = (a, b, outwardDir, factor = 0.6) => {
    const mid = midpoint(a, b);
    const n = normalize(outwardDir);
    return { x: mid.x + n.x * extLen * factor, y: mid.y + n.y * extLen * factor };
  };

  // Up-left: edge-aligned point and horizontal-left point; outward normal goes up-left
  const upLeftBaseA = topLeftExtend;
  const upLeftBaseB = topHorizLeft;
  const upLeftNormal = normalize({ x: -1, y: -1 });
  const upLeftThird = outwardPoint(upLeftBaseA, upLeftBaseB, upLeftNormal);

  // Up-right: edge-aligned and horizontal-right; outward up-right
  const upRightBaseA = topHorizRight;
  const upRightBaseB = topRightExtend;
  const upRightNormal = normalize({ x: 1, y: -1 });
  const upRightThird = outwardPoint(upRightBaseA, upRightBaseB, upRightNormal);

  // Down-left: base extension and angled extension; outward down-left
  const downLeftBaseA = leftBaseExtend;
  const downLeftBaseB = leftDownExtend;
  const downLeftNormal = normalize({ x: -1, y: 1 });
  const downLeftThird = outwardPoint(downLeftBaseA, downLeftBaseB, downLeftNormal);

  // Down-right: base extension and angled extension; outward down-right
  const downRightBaseA = rightDownExtend;
  const downRightBaseB = rightBaseExtend;
  const downRightNormal = normalize({ x: 1, y: 1 });
  const downRightThird = outwardPoint(downRightBaseA, downRightBaseB, downRightNormal);

  const navButtons = [
    {
      id: 'up-left',
      points: `${upLeftBaseA.x},${upLeftBaseA.y} ${upLeftBaseB.x},${upLeftBaseB.y} ${upLeftThird.x},${upLeftThird.y}`
    },
    {
      id: 'up-right',
      points: `${upRightBaseA.x},${upRightBaseA.y} ${upRightBaseB.x},${upRightBaseB.y} ${upRightThird.x},${upRightThird.y}`
    },
    {
      id: 'down-left',
      points: `${downLeftBaseA.x},${downLeftBaseA.y} ${downLeftBaseB.x},${downLeftBaseB.y} ${downLeftThird.x},${downLeftThird.y}`
    },
    {
      id: 'down-right',
      points: `${downRightBaseA.x},${downRightBaseA.y} ${downRightBaseB.x},${downRightBaseB.y} ${downRightThird.x},${downRightThird.y}`
    }
  ];
  
  // Subdivision midpoints of center triangle
  const centerSubMidLeft = { x: (centerTop.x + centerLeft.x) / 2, y: (centerTop.y + centerLeft.y) / 2 };
  const centerSubMidRight = { x: (centerTop.x + centerRight.x) / 2, y: (centerTop.y + centerRight.y) / 2 };
  const centerSubMidBottom = { x: (centerLeft.x + centerRight.x) / 2, y: centerLeft.y };
  
  // Inner triangles with subdivision indicators
  const innerTriangles = [
    { 
      id: 'top', 
      points: `${centerTop.x},${centerTop.y} ${centerSubMidLeft.x},${centerSubMidLeft.y} ${centerSubMidRight.x},${centerSubMidRight.y}`,
      subTriangle: (() => {
        const p1 = centerTop;
        const p2 = centerSubMidLeft;
        const p3 = centerSubMidRight;
        const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const m2 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
        const m3 = { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2 };
        return `${m2.x},${m2.y} ${m1.x},${m1.y} ${m3.x},${m3.y}`;
      })()
    },
    { 
      id: 'left', 
      points: `${centerLeft.x},${centerLeft.y} ${centerSubMidBottom.x},${centerSubMidBottom.y} ${centerSubMidLeft.x},${centerSubMidLeft.y}`,
      subTriangle: (() => {
        const p1 = centerLeft;
        const p2 = centerSubMidBottom;
        const p3 = centerSubMidLeft;
        const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const m2 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
        const m3 = { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2 };
        return `${m2.x},${m2.y} ${m1.x},${m1.y} ${m3.x},${m3.y}`;
      })()
    },
    { 
      id: 'right', 
      points: `${centerRight.x},${centerRight.y} ${centerSubMidRight.x},${centerSubMidRight.y} ${centerSubMidBottom.x},${centerSubMidBottom.y}`,
      subTriangle: (() => {
        const p1 = centerRight;
        const p2 = centerSubMidRight;
        const p3 = centerSubMidBottom;
        const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const m2 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
        const m3 = { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2 };
        return `${m2.x},${m2.y} ${m1.x},${m1.y} ${m3.x},${m3.y}`;
      })()
    }
  ];
  
  const shrinkFactor = 0.65;
  const outerCenter = { x: (centerSubMidLeft.x + centerSubMidRight.x + centerSubMidBottom.x) / 3, y: (centerSubMidLeft.y + centerSubMidRight.y + centerSubMidBottom.y) / 3 };
  const innerP1 = shrinkPoint(centerSubMidBottom, outerCenter, shrinkFactor);
  const innerP2 = shrinkPoint(centerSubMidLeft, outerCenter, shrinkFactor);
  const innerP3 = shrinkPoint(centerSubMidRight, outerCenter, shrinkFactor);
  
  const innerInnerFactor = 0.5;
  const innerInnerP1 = shrinkPoint(innerP1, outerCenter, innerInnerFactor);
  const innerInnerP2 = shrinkPoint(innerP2, outerCenter, innerInnerFactor);
  const innerInnerP3 = shrinkPoint(innerP3, outerCenter, innerInnerFactor);

  const viewPad = halfSide;

  return (
    <svg 
      viewBox={`${-viewPad} ${-viewPad} ${size + viewPad * 2} ${size + viewPad * 2}`}
      className="triangle-nav-svg"
      style={{ maxWidth: '320px', margin: '20px auto', display: 'block' }}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      {/* Center upright triangle - main focus */}
      <polygon
        points={`${centerTop.x},${centerTop.y} ${centerLeft.x},${centerLeft.y} ${centerRight.x},${centerRight.y}`}
        fill="none"
        stroke={glowColor}
        strokeWidth="1.5"
        opacity="0.4"
      />
      
      {/* Guide lines extending from the top vertex */}
      <line x1={centerTop.x} y1={centerTop.y} x2={topUpExtend.x} y2={topUpExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />
      <line x1={centerTop.x} y1={centerTop.y} x2={topLeftExtend.x} y2={topLeftExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />
      <line x1={centerTop.x} y1={centerTop.y} x2={topRightExtend.x} y2={topRightExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />

      {/* Guide lines extending from bottom and angled edges */}
      <line x1={centerLeft.x} y1={centerLeft.y} x2={leftBaseExtend.x} y2={leftBaseExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />
      <line x1={centerRight.x} y1={centerRight.y} x2={rightBaseExtend.x} y2={rightBaseExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />
      <line x1={centerLeft.x} y1={centerLeft.y} x2={leftDownExtend.x} y2={leftDownExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />
      <line x1={centerRight.x} y1={centerRight.y} x2={rightDownExtend.x} y2={rightDownExtend.y}
        stroke={glowColor} strokeWidth="1" opacity="0.3" pointerEvents="none" />
      
      {/* Navigation buttons (4 directional) */}
      {navButtons.map((btn) => {
        const isDisabled = disabled || disabledButtons[btn.id];
        return (
        <g key={btn.id} className="tri-nav-group">
          <polygon
            points={btn.points}
            fill={accentColor}
            stroke={glowColor}
            strokeWidth="1.5"
            opacity="0.6"
            className={`tri-nav-btn ${isDisabled ? 'disabled' : ''}`}
            onClick={() => !isDisabled && handleClick(btn.id)}
            style={{ 
              cursor: isDisabled ? 'default' : 'pointer',
              opacity: isDisabled ? 0.4 : 0.6,
              filter: 'url(#glow)'
            }}
          />
        </g>
        );
      })}
      
      {/* Inner triangles with subdivision indicators */}
      {innerTriangles.map(tri => {
        const isDisabled = disabled || disabledButtons[`inner-${tri.id}`];
        return (
        <g key={tri.id} className="tri-nav-group">
          <polygon
            points={tri.points}
            fill={fillColor}
            stroke={glowColor}
            strokeWidth="1.5"
            className={`tri-nav-btn ${isDisabled ? 'disabled' : ''}`}
            onClick={() => !isDisabled && handleClick(`inner-${tri.id}`)}
            style={{ 
              cursor: isDisabled ? 'default' : 'pointer',
              opacity: isDisabled ? 0.3 : 0.5,
              filter: 'url(#glow)'
            }}
          />
          {/* Subdivision indicator - center triangle */}
          <polygon
            points={tri.subTriangle}
            fill={accentColor}
            opacity="0.4"
            className="tri-nav-subfill"
            pointerEvents="none"
          />
        </g>
        );
      })}
      
      {/* Center - parent button with nested triangles */}
      <g className="tri-nav-group">
        {(() => {
          const isDisabled = disabled || disabledButtons['parent'];
          return (
          <>
        <polygon
          points={`${innerP1.x},${innerP1.y} ${innerP2.x},${innerP2.y} ${innerP3.x},${innerP3.y}`}
          fill={fillColorCenter}
          stroke={warnColor}
          strokeWidth="1.5"
          className={`tri-nav-btn ${isDisabled ? 'disabled' : ''}`}
          onClick={() => !isDisabled && handleClick('parent')}
          style={{ 
            cursor: isDisabled ? 'default' : 'pointer',
            opacity: isDisabled ? 0.4 : 0.6,
            filter: 'url(#glow)'
          }}
        />
        {/* Inner nested triangle */}
        <polygon
          points={`${innerInnerP1.x},${innerInnerP1.y} ${innerInnerP2.x},${innerInnerP2.y} ${innerInnerP3.x},${innerInnerP3.y}`}
          fill="none"
          stroke={warnColor}
          strokeWidth="1"
          opacity="0.5"
          className="tri-nav-subfill"
          pointerEvents="none"
        />
          </>
          );
        })()}
      </g>
    </svg>
  );
}
