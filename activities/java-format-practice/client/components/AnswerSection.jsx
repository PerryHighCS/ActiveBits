import React, { useMemo } from 'react';

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
}) {
  const firstInputRef = React.useRef(null);

  React.useEffect(() => {
    if (focusToken === undefined) return;
    if (firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [focusToken]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isDisabled && !submitDisabled && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  const splitParts = (text = '') => {
    if (!text.includes(',')) return [text];
    return text.split(',').map((p) => p.trim());
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

  return (
    <div className="answer-section">
      <div className="ide-shell" aria-label="Format string editor">
        <div className="ide-header">
          <span className="ide-dot ide-dot-red" />
          <span className="ide-dot ide-dot-amber" />
          <span className="ide-dot ide-dot-green" />
          <span className="ide-filename">FormatPractice.java</span>
        </div>

        <div className="ide-body">
          {variables.map((v, idx) => (
            <div className="ide-line" key={`${v.name}-${idx}`}>
              <div className="ide-gutter">{idx + 1}</div>
              <code className="ide-code">
                <span className="ide-static">{`${v.type} ${v.name} = ${v.value};`}</span>
              </code>
            </div>
          ))}

          {formatCalls.map((call, idx) => {
            const parsed = parsedCalls[idx];
            const solved = solvedAnswers[idx];
            const active = isActive(idx);
            const lineNumberBase = variables.length + idx * 2 + 1;
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
                            className="ide-input ide-input-advanced"
                            type="text"
                            value={values[0] || ''}
                            onChange={(e) => handleInputChange(idx, 0, e.target.value)}
                            disabled={isDisabled}
                            ref={idx === currentIndex ? firstInputRef : null}
                            onKeyDown={handleKeyDown}
                            style={{ width: `${Math.max((values[0] || '').length, 20)}ch` }}
                            spellCheck={false}
                            autoComplete="off"
                          />
                        ) : (
                          // Beginner/Intermediate mode: separate inputs for each part
                          parsed.parts.map((part, partIdx) => {
                            const val = values[partIdx] || '';
                            const isLast = partIdx === parsed.parts.length - 1;
                            const isFirstInput = idx === currentIndex && partIdx === 0;
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
                                  ref={isFirstInput ? firstInputRef : null}
                                  onKeyDown={handleKeyDown}
                                  style={{ width: `${Math.max(val.length, 1)}ch` }}
                                  spellCheck={false}
                                  autoComplete="off"
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
    </div>
  );
}
