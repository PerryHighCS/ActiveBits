export default {
  id: 'sortdemo',
  name: 'Sort Demo (Legacy)',
  description: 'Legacy sorting demonstration - use algorithm-demo instead',
  color: 'gray',
  isDev: true, // Mark as dev to exclude from production tests
  soloMode: false,
  clientEntry: './client/index.jsx',
  serverEntry: null, // No server routes needed for legacy
};
