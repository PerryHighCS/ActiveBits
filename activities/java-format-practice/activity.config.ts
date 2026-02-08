import type { ActivityConfig } from '../../types/activity.js'

const javaFormatPracticeConfig: ActivityConfig = {
  id: 'java-format-practice',
  name: 'Java Format Practice',
  description: 'Interactive practice for Java printf and String.format',
  color: 'emerald',
  soloMode: true,
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default javaFormatPracticeConfig
