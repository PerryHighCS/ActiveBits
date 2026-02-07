import type { ActivityConfig } from '../../types/activity.js'

const algorithmDemoConfig: ActivityConfig = {
  id: 'algorithm-demo',
  name: 'Algorithm Demonstrations',
  description: 'Instructor-driven algorithm demonstrations with synchronized visualization',
  color: 'indigo',
  soloMode: true,
  soloModeMeta: {
    title: 'Algorithm Practice',
    description: 'Explore sorting, searching, and recursion algorithms independently',
    buttonText: 'Copy Algorithm Practice Link',
  },
  deepLinkOptions: {
    algorithm: {
      label: 'Pre-select Algorithm',
      type: 'select',
      options: [
        { value: '', label: '(None - manual selection)' },
        { value: 'linear-search', label: 'Linear Search' },
        { value: 'guessing-game', label: 'Binary Search Game' },
        { value: 'binary-search', label: 'Binary Search' },
        { value: 'selection-sort', label: 'Selection Sort' },
        { value: 'insertion-sort', label: 'Insertion Sort' },
        { value: 'merge-sort', label: 'Merge Sort' },
        { value: 'factorial', label: 'Factorial (Recursion)' },
        { value: 'fibonacci', label: 'Fibonacci (Recursion)' },
      ],
    },
  },
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.js',
}

export default algorithmDemoConfig
