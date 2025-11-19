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
            "Programming Language",
            "Code Challenge",
            "Method Overloading",
            "Class Inheritance",
            "Variable Declaration",
            "Loop Iteration",
            "Array Processing",
            "Exception Handling",
            "Memory Management",
            "Database Connection",
            "User Interface",
            "System Architecture",
            "Network Protocol",
            "File Operations",
            "String Manipulation",
            "Boolean Logic",
            "Integer Values",
            "Character Arrays",
            "Method Parameters",
            "Return Statement"
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
  const varNames = ["text", "str", "message", "word", "sentence", "data", 
                "input", "content", "value", "line", "phrase", "title"];
  const varName = varNames[Math.floor(Math.random() * varNames.length)];
  
  // Ensure we have a minimum string length for meaningful challenges
  if (text.length < 3) {
    // Fallback to a longer string if somehow a very short string is selected
    return generateSubstringChallenge();
  }
  
  if (Math.random() < 0.5) {
    // 1-parameter version: substring(start)
    // Ensure we don't start at the very end (leave at least 1 character)
    const maxStart = text.length - 1;
    const start = Math.floor(Math.random() * maxStart);
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
    // 2-parameter version: substring(start, end)
    // Strategy: Pick a start position, then pick an end position after it
    // Ensure at least 1 character in the result for meaningful practice
    const maxStart = text.length - 2; // Leave room for at least 1 character
    // Random start from 0 to maxStart (inclusive)
    const start = Math.floor(Math.random() * (maxStart + 1));
    
    // End must be > start and <= text.length
    // Ensure at least 1 character by starting from start + 1
    const minEnd = start + 1;
    const maxEnd = text.length;
    // Generate end from minEnd to maxEnd (inclusive)
    // Math.random() returns [0, 1), so Math.random() * n returns [0, n)
    // Math.floor of that gives [0, n-1], so we need (maxEnd - minEnd + 1) to get full range
    const end = minEnd + Math.floor(Math.random() * (maxEnd - minEnd + 1));
    
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
  const varNames = ["text", "str", "message", "word", "sentence", "data", 
                "input", "content", "value", "line", "phrase", "title"];
  const varName = varNames[Math.floor(Math.random() * varNames.length)];
  
  // Realistic not-found search terms
  const notFoundTerms = [
    'z', 'q', 'x', 'Z', 'Q', 'X',
    'the', 'and', 'for', 'with', 'code', 'test',
    '123', '!', '@', '#', '?', '.',
    'ing', 'tion', 'ment', 'ness',
  ];
  
  // Helper function to generate a not-found term
  const generateNotFoundTerm = () => {
    let searchTerm;
    let attempts = 0;
    
    // 50% chance to use capitalization change from text, 50% use random term
    if (Math.random() < 0.5 && text.length > 3) {
      // Extract a substring and change its capitalization
      const words = text.split(' ').filter(w => w.length > 0);
      const chars = text.split('').filter(c => c !== ' ' && c.length > 0);
      
      if (words.length > 0 && Math.random() < 0.7) {
        // Use a word with changed capitalization
        const word = words[Math.floor(Math.random() * words.length)];
        const changeType = Math.random();
        if (changeType < 0.33) {
          searchTerm = word.toUpperCase();
        } else if (changeType < 0.66) {
          searchTerm = word.toLowerCase();
        } else {
          // Toggle first letter case
          searchTerm = word.charAt(0) === word.charAt(0).toUpperCase() 
            ? word.charAt(0).toLowerCase() + word.slice(1)
            : word.charAt(0).toUpperCase() + word.slice(1);
        }
      } else if (chars.length > 0) {
        // Use a character with changed case
        const char = chars[Math.floor(Math.random() * chars.length)];
        searchTerm = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
      } else {
        searchTerm = notFoundTerms[Math.floor(Math.random() * notFoundTerms.length)];
      }
      
      // Verify it's actually not found
      if (text.indexOf(searchTerm) !== -1) {
        searchTerm = notFoundTerms[Math.floor(Math.random() * notFoundTerms.length)];
      }
    } else {
      // Use a random not-found term
      searchTerm = notFoundTerms[Math.floor(Math.random() * notFoundTerms.length)];
    }
    
    // Final safety check
    do {
      if (text.indexOf(searchTerm) === -1) break;
      searchTerm = notFoundTerms[Math.floor(Math.random() * notFoundTerms.length)];
      attempts++;
    } while (attempts < 20);
    
    return searchTerm;
  };
  
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
      searchTerm = generateNotFoundTerm();
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
    let searchTerm, startIndex, expectedAnswer;
    
    if (Math.random() < 0.7) {
      // Choose an existing character/substring and ensure it can be found
      const chars = [...new Set(text.split(''))].filter(c => c !== ' ');
      searchTerm = chars[Math.floor(Math.random() * chars.length)] || 'a';
      
      // Find all occurrences of the search term
      const occurrences = [];
      for (let i = 0; i < text.length; i++) {
        if (text.indexOf(searchTerm, i) === i) {
          occurrences.push(i);
        }
      }
      
      if (occurrences.length > 0 && Math.random() < 0.6) {
        // Pick a start index that will find the character (before or at an occurrence)
        const targetOccurrence = occurrences[Math.floor(Math.random() * occurrences.length)];
        startIndex = Math.floor(Math.random() * (targetOccurrence + 1));
        expectedAnswer = text.indexOf(searchTerm, startIndex);
      } else {
        // Pick a start index that might not find it (after all occurrences)
        if (occurrences.length > 0) {
          const lastOccurrence = occurrences[occurrences.length - 1];
          startIndex = lastOccurrence + 1;
        } else {
          startIndex = 0;
        }
        expectedAnswer = text.indexOf(searchTerm, startIndex);
      }
    } else {
      // Search for something that doesn't exist
      searchTerm = generateNotFoundTerm();
      startIndex = Math.floor(Math.random() * Math.max(1, text.length - 1));
      expectedAnswer = -1;
    }
    
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
  const strings = ["Hello", "hello", "HELLO", "Hello World", "hello world", 
                "Java", "java", "JAVA", "Programming", "programming",
                "Code", "code", "String", "string", "Method", "method",
                "Class", "class", "Object", "object", "Array", "array"];
  const varNames = [
                ["str1", "str2"], ["name1", "name2"], ["word1", "word2"], 
                ["text", "other"], ["first", "second"], ["left", "right"],
                ["original", "copy"], ["input", "target"], ["source", "dest"],
                ["userInput", "expected"], ["message1", "message2"], ["title", "header"],
                ["itemA", "itemB"], ["valueX", "valueY"], ["dataOne", "dataTwo"]
            ];
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
  const strings = ["", "a", "Hi", "Java", "Hello", "Programming", "Hello World",
                "String Methods", "Computer Science", 
                "a b c", "123", "Hello123", "Special!@#", "Multi Word String"];
  const varNames = [
                "text", "str", "message", "word", "sentence", "data", 
                "input", "content", "value", "line", "phrase", "title"
            ];
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
                ["Java", "Java"],
                ["hello", "hello"],
                
                // First comes before second alphabetically (negative result)
                ["apple", "banana"],
                ["cat", "dog"],
                ["hello", "world"],
                ["Java", "Python"],
                ["abc", "def"],
                
                // First comes after second alphabetically (positive result)
                ["banana", "apple"],
                ["dog", "cat"],
                ["world", "hello"],
                ["Python", "Java"],
                ["def", "abc"],
                
                // Case sensitivity examples
                ["Apple", "apple"], // Capital A comes before lowercase a
                ["java", "Java"],   // Lowercase j comes after capital J
                ["Hello", "hello"]
  ];
  
  const varNames = [
                ["str1", "str2"], ["name1", "name2"], ["word1", "word2"], 
                ["text", "other"], ["first", "second"], ["left", "right"],
                ["original", "copy"], ["input", "target"], ["source", "dest"],
                ["userInput", "expected"], ["message1", "message2"], ["title", "header"],
                ["itemA", "itemB"], ["valueX", "valueY"], ["dataOne", "dataTwo"]
            ];
  const [var1, var2] = varNames[Math.floor(Math.random() * varNames.length)];
  const [text1, text2] = stringPairs[Math.floor(Math.random() * stringPairs.length)];
  
  const firstVarCallsMethod = Math.random() < 0.5;
  const callingVar = firstVarCallsMethod ? var1 : var2;
  const parameterVar = firstVarCallsMethod ? var2 : var1;
  const callingText = firstVarCallsMethod ? text1 : text2;
  const parameterText = firstVarCallsMethod ? text2 : text1;
  
  // Use lexicographic comparison to match Java's compareTo() behavior
  // Java uses Unicode values, not locale-aware comparison like localeCompare()
  let expectedAnswer;
  if (callingText === parameterText) {
    expectedAnswer = 0;
  } else if (callingText < parameterText) {
    // JavaScript's < operator compares strings lexicographically (same as Java)
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
    question: `What will <code>${callingVar}.compareTo(${parameterVar})</code> return?`
  };
}

/**
 * Validate user's answer against the challenge
 */
export function validateAnswer(challenge, userAnswer) {
  if (challenge.type === 'equals') {
    const answer = String(userAnswer).toLowerCase();
    const expected = String(challenge.expectedAnswer).toLowerCase();
    return answer === expected;
  } else if (challenge.type === 'compareTo') {
    const normalized = String(userAnswer).toLowerCase().trim();
    const expected = String(challenge.expectedAnswer).toLowerCase();
    return normalized === expected;
  } else {
    return String(userAnswer) === String(challenge.expectedAnswer);
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
