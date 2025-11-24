import { WORD_LISTS } from './pools';
import { randomItem } from './utils';

export function buildChoicePool(baseValues, extras = [], useWords = false, targetSize = 8) {
  const seen = new Set();
  const uniquePool = [];
  const addValue = (value) => {
    const key = typeof value === 'string' ? `s:${value}` : `n:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePool.push(value);
    }
  };
  [...baseValues, ...extras].forEach(addValue);
  const wordsSource = WORD_LISTS.flat();
  while (uniquePool.length < targetSize) {
    const candidate = useWords ? randomItem(wordsSource) : Math.floor(Math.random() * 20);
    addValue(candidate);
  }
  return uniquePool.sort(() => Math.random() - 0.5);
}

export function buildListFinalChoices(values, useWords, baseLength = null, newLength = null, targetSize = 8, extraValues = []) {
  const baseKeys = new Set();
  const baseValues = [];
  if (Array.isArray(values)) {
    values.forEach((val) => {
      if (val === undefined) return;
      const key = typeof val === 'string' ? `s:${val}` : `n:${val}`;
      if (baseKeys.has(key)) return;
      baseKeys.add(key);
      baseValues.push(val);
    });
  }
  const candidateExtras = [];
  const extraKeys = new Set();
  const addCandidate = (val) => {
    if (val === undefined) return;
    const key = typeof val === 'string' ? `s:${val}` : `n:${val}`;
    if (baseKeys.has(key) || extraKeys.has(key)) return;
    extraKeys.add(key);
    candidateExtras.push(val);
  };
  if (Array.isArray(extraValues)) {
    extraValues.forEach(addCandidate);
  }
  if (typeof baseLength === 'number') addCandidate(baseLength);
  if (typeof newLength === 'number' && newLength !== baseLength) addCandidate(newLength);
  const neededExtras = Math.max(0, targetSize - baseValues.length);
  const extraPool = neededExtras > 0 ? buildChoicePool([], candidateExtras, useWords, neededExtras) : [];
  const finalList = [...baseValues];
  if (neededExtras > 0) {
    finalList.push(...extraPool.slice(0, neededExtras));
  }
  for (let i = finalList.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [finalList[i], finalList[j]] = [finalList[j], finalList[i]];
  }
  return finalList;
}

export function buildRangeChoicePool(values, stopValue = null) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const spanStart = Math.min(minVal, maxVal);
  const spanEnd = Math.max(minVal, maxVal);
  const contiguous = [];
  for (let n = spanStart; n <= spanEnd; n += 1) {
    contiguous.push(n);
  }
  const extras = [spanStart - 1, spanEnd + 1];
  if (typeof stopValue === 'number' && !contiguous.includes(stopValue)) {
    extras.push(stopValue);
  }
  return buildListFinalChoices(contiguous, false, null, null, Math.min(12, contiguous.length + 2), extras);
}

export function buildLengthChoices(length, lastValue) {
  const extras = [Math.max(0, length - 1), length + 1, length + 2];
  if (lastValue !== undefined) {
    extras.push(lastValue);
  }
  return buildChoicePool([length], extras, false, 6);
}
