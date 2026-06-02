import type { ActivityConfig } from '../../types/activity.js'

const binaryBreachConfig: ActivityConfig = {
  id: 'binary-breach',
  name: 'Binary Breach',
  description: 'Restore locked systems by solving binary and decimal challenges',
  color: 'cyan',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    supportsPermalink: true,
    showOnHome: true,
    title: 'Binary Breach: System Override',
    description: 'Practice binary conversion, comparison, and ordering through system recovery missions',
  },
  waitingRoom: {
    fields: [
      {
        id: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: true,
        placeholder: 'Your name',
      },
    ],
  },
  deepLinkOptions: {
    maxBits: {
      label: 'Maximum bits',
      type: 'select',
      defaultValue: '8',
      options: [
        { value: '4', label: '4 bits' },
        { value: '5', label: '5 bits' },
        { value: '6', label: '6 bits' },
        { value: '7', label: '7 bits' },
        { value: '8', label: '8 bits' },
      ],
    },
    missionLength: {
      label: 'Systems per mission',
      type: 'number',
      defaultValue: 5,
      min: 3,
      max: 12,
      step: 1,
    },
    challengeTypes: {
      label: 'Challenge types',
      type: 'multiselect',
      defaultValue: ['binary-to-decimal', 'decimal-to-binary', 'compare-binary', 'order-binary'],
      options: [
        { value: 'binary-to-decimal', label: 'Binary to decimal' },
        { value: 'decimal-to-binary', label: 'Decimal to binary' },
        { value: 'compare-binary', label: 'Compare binary' },
        { value: 'order-binary', label: 'Order binary' },
      ],
    },
    hintsEnabled: {
      label: 'Hints available',
      type: 'checkbox',
      defaultValue: true,
    },
    placeValueSupport: {
      label: 'Place-value support',
      type: 'select',
      defaultValue: 'visible',
      options: [
        { value: 'visible', label: 'Visible' },
        { value: 'optional', label: 'Optional' },
        { value: 'hidden', label: 'Hidden' },
      ],
    },
  },
  standaloneLayout: {
    expandShell: true,
  },
  studentLayout: {
    expandShell: true,
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default binaryBreachConfig
