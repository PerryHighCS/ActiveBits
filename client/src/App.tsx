import { Fragment, Suspense, type ComponentType, type ReactElement } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import SessionRouter from './components/common/SessionRouter'
import SessionEnded from './components/common/SessionEnded'
import ManageDashboard from './components/common/ManageDashboard'
import StatusDashboard from './components/common/StatusDashboard'
import LoadingFallback from './components/common/LoadingFallback'
import ManagedSessionRoute from './components/common/ManagedSessionRoute'
import ActivityLauncher from './components/common/ActivityLauncher'
import { activities } from './activities'
import { findFooterActivity } from './appUtils'

const footerClass =
  'text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto empty:hidden empty:mt-0 empty:border-0 empty:p-0'

type AnyComponent = ComponentType<Record<string, unknown>>

function Footer() {
  const location = useLocation()
  const footerActivity = findFooterActivity(location.pathname, activities)

  if (!footerActivity?.FooterComponent) {
    return null
  }

  const FooterComponent = footerActivity.FooterComponent as AnyComponent

  return (
    <div className={footerClass}>
      <Suspense fallback={null}>
        <FooterComponent />
      </Suspense>
    </div>
  )
}

function AppShell() {
  const location = useLocation()
  const pathSegments = location.pathname.split('/').filter(Boolean)
  const manageActivityId = pathSegments[0] === 'manage' && pathSegments.length >= 2 ? pathSegments[1] : null
  const manageActivity = manageActivityId ? activities.find((activity) => activity.id === manageActivityId) : null
  const shouldExpandShell = manageActivity?.manageLayout?.expandShell === true
  const appClassName = shouldExpandShell
    ? 'w-full flex flex-col items-center min-h-screen print:pt-0 print:px-0 md:bg-gray-100 print:bg-white'
    : 'w-full flex flex-col items-center min-h-screen pt-4 md:pt-10 px-4 sm:px-6 md:px-10 print:pt-0 print:px-0 md:bg-gray-100 print:bg-white'

  return (
    <div className={appClassName}>
      <div className="w-full grow">
        <Routes>
          <Route path="/status" element={<StatusDashboard />} />
          <Route path="/manage" element={<ManageDashboard />} />
          <Route path="/launch/:activityId" element={<ActivityLauncher />} />
          <Route path="/session-ended" element={<SessionEnded />} />

          {activities.map((activity) => {
            const ManagerComponent = activity.ManagerComponent
            const UtilComponent = activity.UtilComponent
            if (!ManagerComponent && !UtilComponent) return null

            const routes: ReactElement[] = []

            if (ManagerComponent) {
              const TypedManagerComponent = ManagerComponent as AnyComponent
              routes.push(
                <Route
                  key="manage"
                  path={`/manage/${activity.id}`}
                  element={
                    <Suspense fallback={<LoadingFallback />}>
                      <TypedManagerComponent />
                    </Suspense>
                  }
                />,
                <Route
                  key="manage-session"
                  path={`/manage/${activity.id}/:sessionId`}
                  element={
                    <ManagedSessionRoute>
                      <Suspense fallback={<LoadingFallback />}>
                        <TypedManagerComponent />
                      </Suspense>
                    </ManagedSessionRoute>
                  }
                />,
              )
            }

            if (UtilComponent) {
              const TypedUtilComponent = UtilComponent as AnyComponent
              routes.push(
                <Route
                  key="util"
                  path={`/util/${activity.id}`}
                  element={
                    <Suspense fallback={<LoadingFallback />}>
                      <TypedUtilComponent />
                    </Suspense>
                  }
                />,
              )
            }

            return <Fragment key={activity.id}>{routes}</Fragment>
          })}

          <Route path="/activity/:activityName/:hash" element={<SessionRouter />} />
          <Route path="/solo/:soloActivityId" element={<SessionRouter />} />
          <Route path="/util/:utilityActivityId/:utilityId" element={<SessionRouter />} />

          <Route path="/:sessionId" element={<SessionRouter />} />
          <Route path="/" element={<SessionRouter />} />
        </Routes>
      </div>

      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
