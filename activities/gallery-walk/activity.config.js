export default {
  id: 'gallery-walk',
  name: 'Gallery Walk',
  description: 'Students showcase projects and leave peer feedback',
  color: 'blue',
  soloMode: false,
  soloModeMeta: {
    title: 'Review Gallery Walk Feedback',
    description: 'Upload and review feedback that was left for you.',
    buttonText: 'Copy Feedback Review Link',
  },
  clientEntry: './client/index.js',
  serverEntry: './server/routes.js',
};
