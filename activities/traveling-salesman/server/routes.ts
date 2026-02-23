import type { WsRouter } from '../../../types/websocket.js'
import type { TravelingSalesmanRouteApp, TravelingSalesmanSessionStore } from '../travelingSalesmanTypes.js'
import registerSessionRoutes from './routes/session.js'
import registerStudentRoutes from './routes/students.js'
import registerInstructorRoutes from './routes/instructor.js'
import registerAlgorithmRoutes from './routes/algorithms.js'

export default function setupTravelingSalesmanRoutes(
  app: TravelingSalesmanRouteApp,
  sessions: TravelingSalesmanSessionStore,
  ws: WsRouter,
): void {
  registerSessionRoutes(app, sessions, ws)
  registerStudentRoutes(app, sessions, ws)
  registerInstructorRoutes(app, sessions, ws)
  registerAlgorithmRoutes(app, sessions, ws)
}
