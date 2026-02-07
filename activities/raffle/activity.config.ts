import type { ActivityConfig } from '../../types/activity.js'

const raffleConfig: ActivityConfig = {
  id: 'raffle',
  name: 'Raffle',
  description: 'Students scan a QR code to receive a unique ticket',
  color: 'red',
  soloMode: false,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default raffleConfig
