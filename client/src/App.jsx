import { BrowserRouter, Routes, Route } from "react-router";
import { useLocation } from "react-router-dom";
import SessionRouter from "./components/user/SessionRouter";
import RaffleManager from "./components/manager/raffle/RaffleManager";
import WwwSimManager from "./components/manager/wwwsim/WwwSimManager";
import ManageDashboard from './components/manager/ManageDashboard';

function attribution() {
    return (
        <p>
            Portions of this activity are adapted from{" "}
            <a
                href="https://code.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
            >
                Code.org
            </a>{" "}
            Computer Science Principles curriculum. Used under{" "}
            <a
                href="https://code.org/en-US/terms-of-service"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
            >
                CC BY-NC-SA 4.0
            </a>
            .
        </p>
    )
}

function Footer() {
    const location = useLocation();
    if (location.pathname.startsWith("/manage/raffle") || location.pathname === "/") {
        return (
            <div className="text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto">
                {attribution()}
                <p>Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.</p>
            </div>
        );
    }

    // Default footer
    return (
        <div className="text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto">
            {attribution()}
        </div>
    );
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
        <div className='w-full flex flex-col items-center min-h-screen pt-10 px-10'>
            <BrowserRouter>

                <div className='w-full flex-grow'>
                    <Routes>
                        <Route path="/manage" element={<ManageDashboard />} />
                        <Route path="/manage/raffle" element={<RaffleManager />} />
                        <Route path="/manage/raffle/:sessionId" element={<RaffleManager />} />
                        <Route path="/manage/www-sim" element={<WwwSimManager />} />
                        <Route path="/manage/www-sim/:sessionId" element={<WwwSimManager />} />
                        <Route path="/:sessionId" element={<SessionRouter />} />
                        <Route path="/" element={<SessionRouter />} />
                    </Routes>
                </div>

                <Footer />
            </BrowserRouter>
        </div>
    )
}
