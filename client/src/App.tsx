import { Fragment, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import SessionRouter from './components/common/SessionRouter'
import SessionEnded from './components/common/SessionEnded'
import ManageDashboard from './components/common/ManageDashboard'
import StatusDashboard from './components/common/StatusDashboard'
import LoadingFallback from './components/common/LoadingFallback'
import { activities } from './activities'
import { findFooterActivity } from './appUtils'

const footerClass =
  'text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto'

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

export default function App() {
  return (
    <div className="w-full flex flex-col items-center min-h-screen pt-4 md:pt-10 px-4 sm:px-6 md:px-10 print:pt-0 print:px-0 md:bg-gray-100 print:bg-white">
      <BrowserRouter>
        <div className="w-full flex-grow">
          <Routes>
            <Route path="/status" element={<StatusDashboard />} />
            <Route path="/manage" element={<ManageDashboard />} />
            <Route path="/session-ended" element={<SessionEnded />} />

            {activities.map((activity) => {
              const ManagerComponent = activity.ManagerComponent
              if (!ManagerComponent) return null

              const TypedManagerComponent = ManagerComponent as AnyComponent

              return (
                <Fragment key={activity.id}>
                  <Route
                    path={`/manage/${activity.id}`}
                    element={
                      <Suspense fallback={<LoadingFallback />}>
                        <TypedManagerComponent />
                      </Suspense>
                    }
                  />
                  <Route
                    path={`/manage/${activity.id}/:sessionId`}
                    element={
                      <Suspense fallback={<LoadingFallback />}>
                        <TypedManagerComponent />
                      </Suspense>
                    }
                  />
                </Fragment>
              )
            })}

            <Route path="/activity/:activityName/:hash" element={<SessionRouter />} />
            <Route path="/solo/:soloActivityId" element={<SessionRouter />} />

            <Route path="/:sessionId" element={<SessionRouter />} />
            <Route path="/" element={<SessionRouter />} />
          </Routes>
        </div>

        <Footer />
      </BrowserRouter>
    </div>
  )
}
