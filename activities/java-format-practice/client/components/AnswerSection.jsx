import React, { useMemo, useCallback } from 'react';
import FeedbackDisplay from './FeedbackDisplay';
import { splitArgumentsRespectingQuotes } from '../utils/stringUtils';

export default function AnswerSection({
  formatCalls = [],
  variables = [],
  difficulty,
  currentIndex = 0,
  userAnswers = [],
  solvedAnswers = [],
  lineErrors = {},
  onAnswerChange,
  onSubmit,
  isDisabled,
  submitDisabled,
  showReference,
  onShowReference,
  focusToken,
  fileName = 'FormatPractice.java',
  startingLine = 1,
  feedback = null,
  onNewChallenge = null,
  showNextButton = true,
  onFeedbackDismiss = null,
}) {
  const firstInputRef = React.useRef(null);
  const errorInputRef = React.useRef(null);
  const errorLineToFocusRef = React.useRef(null);

  React.useEffect(() => {
    if (focusToken === undefined) return;
    if (firstInputRef.current && !firstInputRef.current.disabled) {
      firstInputRef.current.focus();
    }
  }, [focusToken]);

  // Focus error input after feedback is dismissed
  const prevFeedbackRef = React.useRef(feedback);
  React.useEffect(() => {
    // Check if feedback was just cleared (dismissed)
    if (prevFeedbackRef.current && !feedback && errorInputRef.current) {
      console.log('[AnswerSection] Feedback dismissed, focusing error input:', errorInputRef.current);
      requestAnimationFrame(() => {
        if (errorInputRef.current) {
          errorInputRef.current.focus();
        }
      });
    }
    prevFeedbackRef.current = feedback;
  }, [feedback]);

  React.useEffect(() => {
    // When feedback appears with errors, store the line number to focus later
    if (feedback && !feedback.isCorrect) {
      console.log('[AnswerSection] Error feedback detected:', {
        difficulty,
        currentIndex,
        lineErrors,
        wrongPartIdx: feedback.wrongPartIdx,
        errorPartType: feedback.errorPartType,
        lineErrorsMeta: feedback.lineErrorsMeta
      });
      
      // Check if we have lineErrorsMeta (works for both syntax errors and output mismatches)
      if (feedback.lineErrorsMeta && Object.keys(feedback.lineErrorsMeta).length > 0) {
        // Intermediate/Advanced mode: focus the first error input (line and part)
        const errorIndices = Object.keys(feedback.lineErrorsMeta).map(Number);
        const firstErrorIdx = Math.min(...errorIndices);
        const partIdx = feedback.lineErrorsMeta[firstErrorIdx] !== undefined ? feedback.lineErrorsMeta[firstErrorIdx] : 0;
        const firstErrorLineNumber = startingLine + variables.length + (firstErrorIdx * 2) + 1;
        errorLineToFocusRef.current = { lineNumber: firstErrorLineNumber, partIdx };
        console.log('[AnswerSection] Intermediate/Advanced error focus set:', errorLineToFocusRef.current);
      } else if (difficulty === 'beginner') {
        // Beginner mode: focus the wrong part's input
        // errorPartType indicates what went wrong:
        // - 'format-string': The format specification (e.g., %d, %,d) is wrong
        // - 'string-literal': A quoted string literal is wrong
        // - other types: Variable/argument names are wrong
        const wrongPartIdx = feedback.wrongPartIdx !== undefined ? feedback.wrongPartIdx : 0;
        const currentLineNumber = startingLine + variables.length + (currentIndex * 2) + 1;
        // Store both the line number and part index so we can find the right input
        errorLineToFocusRef.current = { lineNumber: currentLineNumber, partIdx: wrongPartIdx };
        console.log('[AnswerSection] Beginner error focus set:', errorLineToFocusRef.current);
      } else {
        errorLineToFocusRef.current = null;
        console.log('[AnswerSection] No error focus set (no lineErrors and not beginner)');
      }
    }
  }, [feedback, lineErrors, startingLine, variables.length, difficulty, currentIndex]);

  const handleKeyDown = (e) => {
    // Don't submit if feedback modal is showing - let the modal handle Enter
    if (feedback) {
      return;
    }
    
    if (e.key === 'Enter' && !isDisabled && !submitDisabled && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Use the smarter split function that respects format specifiers like %,d
  const splitParts = (text = '') => {
    if (!text.includes(',')) return [text];
    return splitArgumentsRespectingQuotes(text);
  };

  const parsedCalls = useMemo(() => {
    return formatCalls.map((call) => {
      const { skeleton, answer, inputs = [] } = call;
      
      // For advanced difficulty, keep answer as single string (no splitting by comma)
      // For beginner/intermediate, split by comma to create separate input boxes
      const parts = difficulty === 'advanced' ? [answer || ''] : splitParts(answer || '');
      
      if (!skeleton || !answer) {
        return { before: skeleton || '', after: '', answer, parts, inputs };
      }

      // Try direct match first (for intermediate/advanced where quotes are in answer)
      let idx = skeleton.indexOf(answer);
      if (idx !== -1) {
        const rawAfter = skeleton.slice(idx + answer.length);
        return {
          before: skeleton.slice(0, idx),
          after: rawAfter,
          answer,
          parts,
          inputs,
        };
      }

      // For beginner mode: answer doesn't include quotes, but skeleton does
      // Extract the argument section from skeleton: System.out.printf("...", ...);
      const argMatch = skeleton.match(/\((.*)\)\s*;?\s*$/);
      if (argMatch) {
        const argContent = argMatch[1];
        // Find where the arguments start in skeleton
        const argStartIdx = skeleton.indexOf(argMatch[1]);
        if (argStartIdx !== -1) {
          // Before is everything up to and including the opening paren
          const before = skeleton.slice(0, argStartIdx);
          // After is everything after the arguments
          const after = skeleton.slice(argStartIdx + argContent.length);
          return {
            before,
            after,
            answer,
            parts,
            inputs,
          };
        }
      }

      // Fallback
      return { before: skeleton, after: '', answer, parts, inputs };
    });
  }, [formatCalls, difficulty]);

  const handleInputChange = (callIdx, partIdx, value) => {
    if (!onAnswerChange) return;
    onAnswerChange((prev) => {
      const base = Array.isArray(prev) ? [...prev] : new Array(formatCalls.length).fill([]);
      const callAnswers = Array.isArray(base[callIdx])
        ? [...base[callIdx]]
        : new Array(parsedCalls[callIdx]?.parts?.length || 1).fill('');
      callAnswers[partIdx] = value;
      base[callIdx] = callAnswers;
      return base;
    });
  };

  const isActive = (idx) => (difficulty === 'beginner' ? idx === currentIndex : true);

  /**
   * Safely convert a value to a string for use in data attributes.
   * Ensures the value is a valid number or string before conversion.
   * @param {*} value - The value to convert
   * @param {string} defaultValue - The default value if conversion fails
   * @returns {string} The safely converted string value
   */
  const safeDataAttribute = (value, defaultValue = '0') => {
    const converted = String(value);
    // Validate it's not empty and contains valid characters for data attributes
    return converted && /^[\d-]+$/.test(converted) ? converted : defaultValue;
  };

  const getFeedbackTitle = () => {
    if (!feedback) return fileName;
    return feedback.isCorrect 
      ? `${fileName} compiled successfully`
      : `Error in ${fileName}`;
  };

  const handleFeedbackDismiss = () => {
    // Focus is now handled by useEffect when feedback is cleared
    console.log('[AnswerSection] handleFeedbackDismiss called - focus will happen in useEffect');
  };

  const handleDismiss = useCallback(() => {
    // Focus error input BEFORE clearing feedback (to avoid ref being cleared)
    handleFeedbackDismiss();
    
    // Then clear feedback and close modal
    if (onFeedbackDismiss) {
      onFeedbackDismiss();
    }
  }, [feedback, onFeedbackDismiss]);

  const memoizedFeedback = useMemo(() => {
    if (!feedback) return null;
    return {
      ...feedback,
      onDismiss: handleDismiss
    };
  }, [feedback, handleDismiss]);

  return (
    <div className="answer-section">
      <div className="ide-shell" aria-label="Format string editor">
        <div className="ide-header">
          <span className="ide-dot ide-dot-red" />
          <span className="ide-dot ide-dot-amber" />
          <span className="ide-dot ide-dot-green" />
          <span className="ide-filename">{fileName}</span>
        </div>

        <div className="ide-body">
          {variables.map((v, idx) => (
            <div className="ide-line" key={`${v.name}-${idx}`}>
              <div className="ide-gutter">{startingLine + idx}</div>
              <code className="ide-code">
                <span className="ide-static">{`${v.type} ${v.name} = ${v.value};`}</span>
              </code>
            </div>
          ))}

          {formatCalls.map((call, idx) => {
            const parsed = parsedCalls[idx];
            const solved = solvedAnswers[idx];
            const active = isActive(idx);
            const lineNumberBase = startingLine + variables.length + idx * 2;
            const values = Array.isArray(userAnswers[idx]) ? userAnswers[idx] : [];
            // Only show solved answer if solved and hasSubmitted (for intermediate/advanced)
            const showSolved = solved && (difficulty === 'beginner' || (typeof window !== 'undefined' && window.hasSubmitted === true));
            const solvedAdjustedParts = showSolved ? splitParts(solved) : null;
            const lockedSkeleton = call.skeleton
              ? call.skeleton.replace(/\(.*\)/, '(/* Locked until previous challenge complete */)')
              : '/* Locked until previous challenge complete */';

            return (
              <React.Fragment key={`call-${idx}`}>
                <div className="ide-line">
                  <div className="ide-gutter">{lineNumberBase}</div>
                  <code className="ide-code">
                    <span className="ide-static">// {call.prompt.replace(/^Line\s*\d+:\s*/i, '')}</span>
                  </code>
                </div>
                <div className="ide-line">
                  <div className="ide-gutter">{lineNumberBase + 1}</div>
                  <code className="ide-code">
                    {active && parsed.inputs && parsed.inputs.length > 0 ? (
                      <>
                        <span className="ide-static" aria-hidden="true">{parsed.before}</span>
                        {difficulty === 'advanced' ? (
                          // Advanced mode: single input for entire answer
                          <input
                            aria-label={`Line ${idx + 1} input`}
                            className="ide-input"
                            type="text"
                            value={values[0] || ''}
                            onChange={(e) => handleInputChange(idx, 0, e.target.value)}
                            disabled={isDisabled}
                            ref={(el) => {
                              if (idx === 0) {
                                firstInputRef.current = el;
                              }
                              // For advanced mode, also set errorInputRef if this is an error line
                              if (
                                errorLineToFocusRef.current &&
                                errorLineToFocusRef.current.lineNumber === lineNumberBase + 1
                              ) {
                                console.log('[AnswerSection] Setting errorInputRef for advanced mode input:', {
                                  idx,
                                  lineNumber: lineNumberBase + 1,
                                  errorLineToFocus: errorLineToFocusRef.current,
                                  element: el
                                });
                                errorInputRef.current = el;
                              }
                            }}
                            onKeyDown={handleKeyDown}
                            style={{ width: `${Math.max((values[0] || '').length, 20)}ch` }}
                            spellCheck={false}
                            autoComplete="off"
                            data-error-line={safeDataAttribute(lineNumberBase + 1)}
                            data-part-index="0"
                          />
                        ) : (
                          // Beginner/Intermediate mode: separate inputs for each part
                          parsed.parts.map((part, partIdx) => {
                            const val = values[partIdx] || '';
                            const isLast = partIdx === parsed.parts.length - 1;
                            // For beginner: focus first input of current line; for intermediate: focus very first input
                            const isFirstInput = (difficulty === 'beginner' ? idx === currentIndex : idx === 0) && partIdx === 0;
                            const inputMeta = parsed.inputs?.[partIdx] || {};
                            const isFormatString = inputMeta.type === 'format-string';
                            const isStringLiteral = inputMeta.type === 'string-literal';
                            const isConstantString = inputMeta.type === 'constant-string';
                            // In beginner mode, format strings and string literals get quotes, but constant-strings don't
                            const shouldHaveQuotes = difficulty === 'beginner' && (isFormatString || isStringLiteral) && !isConstantString;
                            return (
                              <React.Fragment key={`call-${idx}-part-${partIdx}`}>
                                {shouldHaveQuotes && <span className="ide-static">"</span>}
                                <input
                                  aria-label={`Line ${idx + 1} part ${partIdx + 1} input`}
                                  className="ide-input"
                                  type="text"
                                  value={val}
                                  onChange={(e) => handleInputChange(idx, partIdx, e.target.value)}
                                  disabled={isDisabled}
                                  ref={(el) => {
                                    // Focus for first input in beginner/intermediate
                                    if ((difficulty === 'beginner' ? idx === currentIndex : idx === 0) && partIdx === 0) {
                                      firstInputRef.current = el;
                                    }
                                    
                                    // ALWAYS set errorInputRef if this matches the error location
                                    // (even if feedback hasn't appeared yet - we check errorLineToFocusRef which is set by useEffect)
                                    if (
                                      errorLineToFocusRef.current &&
                                      errorLineToFocusRef.current.lineNumber === lineNumberBase + 1 &&
                                      errorLineToFocusRef.current.partIdx === partIdx
                                    ) {
                                      console.log('[AnswerSection] Setting errorInputRef for input:', {
                                        idx,
                                        partIdx,
                                        lineNumber: lineNumberBase + 1,
                                        errorLineToFocus: errorLineToFocusRef.current,
                                        element: el
                                      });
                                      errorInputRef.current = el;
                                    }
                                  }}
                                  onKeyDown={handleKeyDown}
                                  style={{ width: `${Math.max(val.length, 1)}ch` }}
                                  spellCheck={false}
                                  autoComplete="off"
                                  data-error-line={safeDataAttribute(lineNumberBase + 1)}
                                  data-part-index={safeDataAttribute(partIdx)}
                                />
                                {shouldHaveQuotes && <span className="ide-static">"</span>}
                                {!isLast && <span className="ide-static ide-comma">, </span>}
                              </React.Fragment>
                            );
                          })
                        )}
                        <span className="ide-static" aria-hidden="true">{parsed.after}</span>
                      </>
                    ) : active && (!parsed.inputs || parsed.inputs.length === 0) ? (
                      <span className="ide-static">{call.skeleton}</span>
                    ) : solvedAdjustedParts ? (
                      <>
                        <span className="ide-static" aria-hidden="true">{parsed.before}</span>
                        {solvedAdjustedParts.map((part, partIdx) => {
                          const isLast = partIdx === solvedAdjustedParts.length - 1;
                          const inputMeta = parsed.inputs?.[partIdx] || {};
                          const isFormatString = inputMeta.type === 'format-string';
                          const isStringLiteral = inputMeta.type === 'string-literal';
                          const isConstantString = inputMeta.type === 'constant-string';
                          const shouldHaveQuotes = difficulty === 'beginner' && (isFormatString || isStringLiteral) && !isConstantString;
                          return (
                            <React.Fragment key={`call-${idx}-solved-${partIdx}`}>
                              {shouldHaveQuotes && <span className="ide-static">"</span>}
                              <span className="ide-static">{part}</span>
                              {shouldHaveQuotes && <span className="ide-static">"</span>}
                              {!isLast && <span className="ide-static ide-comma">, </span>}
                            </React.Fragment>
                          );
                        })}
                        <span className="ide-static" aria-hidden="true">{parsed.after}</span>
                      </>
                    ) : (
                      <span className="ide-static">{lockedSkeleton}</span>
                    )}
                  </code>
                </div>
                {lineErrors[idx] && (
                  <div className="ide-line ide-error-line">
                    <div className="ide-gutter"></div>
                    <code className="ide-code ide-error">
                      {lineErrors[idx]}
                    </code>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="answer-controls">
        <button
          className="submit-btn"
          onClick={onSubmit}
          disabled={isDisabled || submitDisabled}
        >
          Check Answer
        </button>
        <button
          className="hint-btn"
          onClick={onShowReference}
          disabled={isDisabled}
        >
          📚 Format Reference
        </button>
      </div>
      
      <FeedbackDisplay
        feedback={memoizedFeedback}
        onNewChallenge={onNewChallenge}
        showNextButton={showNextButton}
        title={getFeedbackTitle()}
      />
    </div>
  );
}
