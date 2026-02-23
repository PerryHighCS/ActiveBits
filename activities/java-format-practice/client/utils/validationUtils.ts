/**
 * Validate that all variable references in expressions are defined.
 * Throws an error if an undefined variable is found.
 */
export function validateVariableReferences(expressions: string[], valueMap: Record<string, unknown>): void {
  const definedVars = Object.keys(valueMap);
  const javaKeywords = ['true', 'false', 'null', 'undefined', 'int', 'long', 'float', 'double', 'boolean', 'byte', 'char', 'short'];
  const allowedMathIdentifiers = ['Math', 'round', 'trunc', 'floor', 'ceil'];
  
  for (const expr of expressions) {
    // Remove quoted strings first to avoid checking variables inside string literals
    const exprWithoutStrings = expr.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
    
    // Extract variable names from the expression (simple regex: word characters)
    const varPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = varPattern.exec(exprWithoutStrings)) !== null) {
      const varName = match[1]
      if (!varName) continue
      // Skip Java keywords, type names, and allowed Math identifiers
      if (javaKeywords.includes(varName)) continue;
      if (allowedMathIdentifiers.includes(varName)) continue;
      if (!definedVars.includes(varName)) {
        throw new Error(`Variable '${varName}' is not defined`);
      }
    }
  }
}
