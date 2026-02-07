import type { ActivityConfig } from '../../types/activity.js'

const javaStringPracticeConfig: ActivityConfig = {
  id: 'java-string-practice',
  name: 'Java String Practice',
  description: 'Interactive practice for Java String methods',
  color: 'purple',
  soloMode: true,
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default javaStringPracticeConfig
