/**
 * ChallengeQuestion Component
 * 
 * Safely renders challenge questions with code formatting.
 * Parses questions to separate code sections and text, avoiding dangerouslySetInnerHTML.
 * This prevents potential XSS vulnerabilities if challenge generation logic changes.
 * 
 * @param {Object} props
 * @param {string} props.question - The question string with embedded <code> tags
 * @returns {JSX.Element} Safely rendered question with code sections
 */
export default function ChallengeQuestion({ question }) {
  // Validate input
  if (!question || typeof question !== 'string') {
    return <div className="question">Invalid question</div>;
  }

  // Parse the question string to extract code sections
  // Expected format: "What will <code>...</code> return?"
  const parts = [];
  let lastIndex = 0;
  const codeRegex = /<code>(.*?)<\/code>/g;
  let match;

  while ((match = codeRegex.exec(question)) !== null) {
    // Add text before the code
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: question.substring(lastIndex, match.index)
      });
    }
    
    // Add the code section (content is automatically escaped by React)
    parts.push({
      type: 'code',
      content: match[1]
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining text
  if (lastIndex < question.length) {
    parts.push({
      type: 'text',
      content: question.substring(lastIndex)
    });
  }

  // Handle case where no code tags are found
  if (parts.length === 0) {
    parts.push({
      type: 'text',
      content: question
    });
  }

  return (
    <div className="question">
      {parts.map((part, index) => 
        part.type === 'code' ? (
          <code key={index}>{part.content}</code>
        ) : (
          <span key={index}>{part.content}</span>
        )
      )}
    </div>
  );
}
