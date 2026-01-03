import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import SessionRouter from "./components/common/SessionRouter";
import SessionEnded from "./components/common/SessionEnded";
import ManageDashboard from './components/common/ManageDashboard';
import StatusDashboard from './components/common/StatusDashboard';
import LoadingFallback from './components/common/LoadingFallback';
import { activities } from './activities';

const footerClass = "text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto";

function Footer() {
    const location = useLocation();

    // Check if we're on an activity manage page and get custom footer content
    for (const activity of activities) {
        if (location.pathname.startsWith(`/manage/${activity.id}`)) {
            const FooterComponent = activity.FooterComponent;
            if (!FooterComponent) return null;
            return (
                <div className={footerClass}>
                    <Suspense fallback={null}>
                        <FooterComponent />
                    </Suspense>
                </div>
            );
        }
    }

    // Default footer for non-activity pages - no footer on home
    return null;
}

/**
 * The main App component that sets up the routing for the application, using React Router
 * to display either the TicketPage or the RaffleManager component based on the URL path.
 * 
 * It also includes a footer with a note about the raffle functionality.
 * 
 * @returns {React.Component} The main App component.
 */
export default function App() {
    return (
        /* The main App component that sets up the routing for the application, using React Router */
        <div className='w-full flex flex-col items-center min-h-screen pt-4 md:pt-10 px-4 sm:px-6 md:px-10 print:pt-0 print:px-0 md:bg-gray-100 print:bg-white'>
            <BrowserRouter>

                <div className='w-full flex-grow'>
                    <Routes>
                        <Route path="/status" element={<StatusDashboard />} />
                        <Route path="/manage" element={<ManageDashboard />} />
                        <Route path="/session-ended" element={<SessionEnded />} />
                        
                        {/* Generate routes for all registered activities */}
                        {activities.map((activity) => {
                            const ManagerComponent = activity.ManagerComponent;
                            return (
                                <React.Fragment key={activity.id}>
                                    <Route
                                        path={`/manage/${activity.id}`}
                                        element={
                                            <Suspense fallback={<LoadingFallback />}>
                                                <ManagerComponent />
                                            </Suspense>
                                        }
                                    />
                                    <Route
                                        path={`/manage/${activity.id}/:sessionId`}
                                        element={
                                            <Suspense fallback={<LoadingFallback />}>
                                                <ManagerComponent />
                                            </Suspense>
                                        }
                                    />
                                </React.Fragment>
                            );
                        })}
                        
                        {/* Persistent session route */}
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
