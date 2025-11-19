import React from 'react';

/**
 * StringDisplay - Interactive string visualization with clickable letter boxes
 * Shows indices, highlights selections, and provides visual hints
 */
export default function StringDisplay({ 
  challenge, 
  selectedIndices, 
  visualHintShown, 
  selectionType,
  onLetterClick,
  onIndexClick 
}) {
  const { text, type } = challenge;
  
  // Determine what to highlight based on challenge type and visual hint
  const getLetterClassName = (index) => {
    const classes = ['letter-box'];
    
    if (visualHintShown) {
      // Show the correct answer visually
      if (type === 'substring') {
        if (challenge.methodType === '1-parameter') {
          if (index >= challenge.start) {
            classes.push('highlighted-answer');
          }
        } else {
          if (index >= challenge.start && index < challenge.end) {
            classes.push('highlighted-answer');
          }
        }
      } else if (type === 'indexOf') {
        const answerIndex = challenge.expectedAnswer;
        // Visual hint for indexOf challenges:
        // - If expectedAnswer is -1: search term not found, nothing to highlight
        // - If expectedAnswer is 0 or positive: highlight the found substring
        // - For indexOf with startIndex, if term not found from that position,
        //   expectedAnswer will be -1 and nothing is highlighted (correct behavior)
        if (answerIndex !== -1) {
          const searchLen = challenge.searchTerm.length;
          if (index >= answerIndex && index < answerIndex + searchLen) {
            classes.push('highlighted-answer');
          }
        }
      }
    } else {
      // Show user's current selection - only if selection type is 'letter'
      if (type === 'substring' && selectionType === 'letter') {
        if (selectedIndices.length === 2) {
          const [start, end] = selectedIndices;
          if (index >= start && index < end) {
            classes.push('selected');
          }
        } else if (selectedIndices.length === 1) {
          // Highlight the first clicked position
          if (index === selectedIndices[0]) {
            classes.push('selected');
          }
        }
      } else if (type === 'indexOf' && selectionType === 'letter') {
        // For indexOf with letter selection, just highlight the clicked letters
        if (selectedIndices.length === 2) {
          const [start, end] = selectedIndices;
          if (index >= start && index < end) {
            classes.push('selected');
          }
        } else if (selectedIndices.length === 1) {
          // Highlight only the single clicked letter
          if (index === selectedIndices[0]) {
            classes.push('selected');
          }
        }
      }
    }
    
    return classes.join(' ');
  };

  const isInteractive = type === 'substring' || type === 'indexOf';

  return (
    <div className="string-display-container">
      {/* Variable declaration */}
      <div className="variable-declaration">
        {type === 'substring' || type === 'indexOf' || type === 'length' ? (
          <>
            String {challenge.varName} = "{text}";
            {visualHintShown && type === 'length' && (
              <span style={{ color: '#38a169', fontWeight: 'bold' }}>
                {' '}// length is {challenge.expectedAnswer}
              </span>
            )}
          </>
        ) : type === 'equals' || type === 'compareTo' ? (
          <>
            String {challenge.var1} = "{challenge.text1}";<br />
            String {challenge.var2} = "{challenge.text2}";
            {visualHintShown && (
              <span style={{ color: '#38a169', fontWeight: 'bold' }}>
                {' '}// {type === 'equals' 
                  ? `equals() returns ${challenge.expectedAnswer}` 
                  : challenge.expectedAnswer === 0
                    ? `compareTo() returns 0 (strings are equal)`
                    : challenge.expectedAnswer === 'negative'
                      ? `compareTo() returns negative ("${challenge.callingText}" < "${challenge.parameterText}")`
                      : `compareTo() returns positive ("${challenge.callingText}" > "${challenge.parameterText}")`}
              </span>
            )}
          </>
        ) : null}
      </div>

      {/* Interactive string display (for substring and indexOf) */}
      {isInteractive && (
        <div className="string-container-wrapper">
          <div className="string-container">
            <div className="index-row">
              {text.split('').map((_, i) => (
                <div 
                  key={i} 
                  className="index-label clickable-index"
                  onClick={() => onIndexClick(i)}
                  style={{ cursor: 'pointer' }}
                >
                  {i}
                </div>
              ))}
            </div>
            <div className="letters-row">
              {text.split('').map((char, i) => (
                <div
                  key={i}
                  className={getLetterClassName(i)}
                  onClick={() => onLetterClick(i)}
                  style={{ cursor: isInteractive ? 'pointer' : 'default' }}
                >
                  {char === ' ' ? '\u00A0' : char}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
