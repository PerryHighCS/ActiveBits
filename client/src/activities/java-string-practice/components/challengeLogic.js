/**
 * Challenge Logic for Java String Practice
 * Extracted and adapted from the original HTML/JS implementation
 */

// Sample strings for challenges
const sampleStrings = [
  "Hello World",
  "Java Programming",
  "String Methods",
  "Computer Science",
  "Learning Code",
  "Practice Makes Perfect",
  "Object Oriented",
  "Data Structures",
  "Algorithm Design",
  "Software Development",
];

// Challenge type configurations
const challengeTypes = {
  substring: {
    name: "substring()",
    hint: "Remember: substring(start) goes to end of string, substring(start, end) goes up to (but not including) end index",
  },
  indexOf: {
    name: "indexOf()",
    hint: "Remember: indexOf(substring) searches from beginning, indexOf(substring, start) searches from start index. Returns -1 if not found",
  },
  equals: {
    name: "equals()",
    hint: "Remember: equals() compares the actual content of strings. It's case-sensitive and returns true or false",
  },
  length: {
    name: "length()",
    hint: "Remember: length() returns the number of characters in the string, including spaces and special characters",
  },
  compareTo: {
    name: "compareTo()",
    hint: "Remember: compareTo() returns 0 if strings are equal, negative if first string comes before second alphabetically, positive if after",
  },
};

/**
 * Generate a new challenge based on selected types
 */
export function generateChallenge(selectedTypes) {
  let availableTypes;
  
  if (selectedTypes.has('all')) {
    availableTypes = Object.keys(challengeTypes);
  } else {
    availableTypes = Array.from(selectedTypes);
  }
  
  const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
  
  let challenge;
  switch (randomType) {
    case 'substring':
      challenge = generateSubstringChallenge();
      break;
    case 'indexOf':
      challenge = generateIndexOfChallenge();
      break;
    case 'equals':
      challenge = generateEqualsChallenge();
      break;
    case 'length':
      challenge = generateLengthChallenge();
      break;
    case 'compareTo':
      challenge = generateCompareToChallenge();
      break;
    default:
      challenge = generateSubstringChallenge();
  }
  
  challenge.type = randomType;
  challenge.hint = challengeTypes[randomType].hint;
  
  return challenge;
}

function generateSubstringChallenge() {
  const text = sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
  const varNames = ["text", "str", "message", "word", "sentence"];
  const varName = varNames[Math.floor(Math.random() * varNames.length)];
  
  if (Math.random() < 0.5) {
    // 1-parameter version
    const start = Math.floor(Math.random() * (text.length - 1));
    const expectedAnswer = text.substring(start);
    
    return {
      text,
      varName,
      start,
      expectedAnswer,
      question: `What will <code>${varName}.substring(${start})</code> return?`,
      methodType: "1-parameter"
    };
  } else {
    // 2-parameter version
    const maxStart = Math.max(0, text.length - 3);
    const start = Math.floor(Math.random() * maxStart);
    const end = start + Math.floor(Math.random() * (text.length - start)) + 1;
    const expectedAnswer = text.substring(start, end);
    
    return {
      text,
      varName,
      start,
      end,
      expectedAnswer,
      question: `What will <code>${varName}.substring(${start}, ${end})</code> return?`,
      methodType: "2-parameter"
    };
  }
}

function generateIndexOfChallenge() {
  const text = sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
  const varNames = ["text", "str", "message", "word"];
  const varName = varNames[Math.floor(Math.random() * varNames.length)];
  
  if (Math.random() < 0.6) {
    // 1-parameter version
    let searchTerm, expectedAnswer;
    
    if (Math.random() < 0.7) {
      // Existing substring
      const words = text.split(' ');
      const chars = [...new Set(text.split(''))].filter(c => c !== ' ');
      const options = [...words, ...chars];
      searchTerm = options[Math.floor(Math.random() * options.length)];
      expectedAnswer = text.indexOf(searchTerm);
    } else {
      // Non-existing
      searchTerm = 'xyz';
      expectedAnswer = -1;
    }
    
    return {
      text,
      varName,
      searchTerm,
      expectedAnswer,
      question: `What will <code>${varName}.indexOf("${searchTerm}")</code> return?`,
      methodType: "1-parameter"
    };
  } else {
    // 2-parameter version
    const chars = [...new Set(text.split(''))].filter(c => c !== ' ');
    const searchTerm = chars[Math.floor(Math.random() * chars.length)] || 'a';
    const startIndex = Math.floor(Math.random() * (text.length - 1));
    const expectedAnswer = text.indexOf(searchTerm, startIndex);
    
    return {
      text,
      varName,
      searchTerm,
      startIndex,
      expectedAnswer,
      question: `What will <code>${varName}.indexOf("${searchTerm}", ${startIndex})</code> return?`,
      methodType: "2-parameter"
    };
  }
}

function generateEqualsChallenge() {
  const strings = ["Hello", "hello", "HELLO", "Java", "java", "Code", "code"];
  const varNames = [["str1", "str2"], ["name1", "name2"], ["word1", "word2"]];
  const [var1, var2] = varNames[Math.floor(Math.random() * varNames.length)];
  
  const text1 = strings[Math.floor(Math.random() * strings.length)];
  let text2, expectedAnswer;
  
  if (Math.random() < 0.4) {
    text2 = text1;
    expectedAnswer = true;
  } else {
    text2 = strings.find(s => s !== text1 && s.toLowerCase() !== text1.toLowerCase()) || "Different";
    expectedAnswer = false;
  }
  
  const firstVarCallsMethod = Math.random() < 0.5;
  const callingVar = firstVarCallsMethod ? var1 : var2;
  const parameterVar = firstVarCallsMethod ? var2 : var1;
  
  return {
    text1,
    text2,
    var1,
    var2,
    callingVar,
    parameterVar,
    expectedAnswer,
    question: `What will <code>${callingVar}.equals(${parameterVar})</code> return?`
  };
}

function generateLengthChallenge() {
  const strings = ["", "a", "Hi", "Java", "Hello", "Programming", "Hello World"];
  const varNames = ["text", "str", "message", "word"];
  const varName = varNames[Math.floor(Math.random() * varNames.length)];
  
  const text = strings[Math.floor(Math.random() * strings.length)];
  const expectedAnswer = text.length;
  
  return {
    text,
    varName,
    expectedAnswer,
    question: `What will <code>${varName}.length()</code> return?`
  };
}

function generateCompareToChallenge() {
  const stringPairs = [
    ["apple", "apple"],
    ["apple", "banana"],
    ["banana", "apple"],
    ["Java", "java"],
  ];
  
  const varNames = [["str1", "str2"], ["word1", "word2"]];
  const [var1, var2] = varNames[Math.floor(Math.random() * varNames.length)];
  const [text1, text2] = stringPairs[Math.floor(Math.random() * stringPairs.length)];
  
  const firstVarCallsMethod = Math.random() < 0.5;
  const callingVar = firstVarCallsMethod ? var1 : var2;
  const parameterVar = firstVarCallsMethod ? var2 : var1;
  const callingText = firstVarCallsMethod ? text1 : text2;
  const parameterText = firstVarCallsMethod ? text2 : text1;
  
  const actualResult = callingText.localeCompare(parameterText);
  let expectedAnswer;
  if (actualResult === 0) {
    expectedAnswer = 0;
  } else if (actualResult < 0) {
    expectedAnswer = "negative";
  } else {
    expectedAnswer = "positive";
  }
  
  return {
    text1,
    text2,
    var1,
    var2,
    callingVar,
    parameterVar,
    callingText,
    parameterText,
    expectedAnswer,
    actualResult,
    question: `What will <code>${callingVar}.compareTo(${parameterVar})</code> return?`
  };
}

/**
 * Validate user's answer against the challenge
 */
export function validateAnswer(challenge, userAnswer) {
  if (challenge.type === 'equals') {
    return userAnswer.toLowerCase() === String(challenge.expectedAnswer).toLowerCase();
  } else if (challenge.type === 'compareTo') {
    const normalized = userAnswer.toLowerCase().trim();
    const expected = String(challenge.expectedAnswer).toLowerCase();
    return normalized === expected;
  } else {
    return userAnswer === String(challenge.expectedAnswer);
  }
}

/**
 * Get explanation for the correct answer
 */
export function getExplanation(challenge) {
  if (challenge.type === 'substring') {
    if (challenge.methodType === "1-parameter") {
      return `substring(${challenge.start}) extracts characters from index ${challenge.start} to the end of the string.`;
    } else {
      return `substring(${challenge.start}, ${challenge.end}) extracts characters from index ${challenge.start} up to (but not including) index ${challenge.end}.`;
    }
  } else if (challenge.type === 'indexOf') {
    if (challenge.expectedAnswer === -1) {
      return `"${challenge.searchTerm}" is not found in the string, so indexOf returns -1.`;
    } else {
      return `"${challenge.searchTerm}" first appears at index ${challenge.expectedAnswer}.`;
    }
  } else if (challenge.type === 'equals') {
    if (challenge.expectedAnswer) {
      return `"${challenge.text1}" and "${challenge.text2}" have exactly the same characters, so equals() returns true.`;
    } else {
      return `"${challenge.text1}" and "${challenge.text2}" are different (equals() is case-sensitive), so equals() returns false.`;
    }
  } else if (challenge.type === 'length') {
    return `The string "${challenge.text}" contains ${challenge.expectedAnswer} characters (including spaces).`;
  } else if (challenge.type === 'compareTo') {
    if (challenge.expectedAnswer === 0) {
      return `"${challenge.callingText}" and "${challenge.parameterText}" are identical, so compareTo() returns 0.`;
    } else if (challenge.expectedAnswer === 'negative') {
      return `"${challenge.callingText}" comes before "${challenge.parameterText}" alphabetically, so compareTo() returns a negative number.`;
    } else {
      return `"${challenge.callingText}" comes after "${challenge.parameterText}" alphabetically, so compareTo() returns a positive number.`;
    }
  }
  return '';
}
