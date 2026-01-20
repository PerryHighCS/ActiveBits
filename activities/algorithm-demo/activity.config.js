export default {
  id: 'algorithm-demo',
  name: 'Algorithm Demonstrations',
  description: 'Instructor-driven algorithm demonstrations with synchronized visualization',
  color: 'orange',
  soloMode: true,
  soloModeMeta: {
    title: 'Algorithm Practice',
    description: 'Explore sorting, searching, and recursion algorithms independently',
    buttonText: 'Copy Algorithm Practice Link',
  },
  clientEntry: './client/index.jsx',
  serverEntry: './server/routes.js',
};
