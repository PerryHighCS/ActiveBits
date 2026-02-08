import type { RouteTypeMap } from './tspUtilsTypes'

export const ROUTE_TYPES: RouteTypeMap = {
  student: {
    label: 'Student',
    color: '#1E88E5',
  },
  bruteforce: {
    label: 'Brute Force (Optimal)',
    color: '#43A047',
  },
  heuristic: {
    label: 'Nearest Neighbor',
    color: '#F9A825',
  },
  instructor: {
    label: 'Instructor',
    color: '#8E24AA',
  },
  highlight: {
    label: 'Highlighted',
    color: '#E53935',
  },
}
