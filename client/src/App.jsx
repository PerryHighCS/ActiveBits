import { BrowserRouter, Routes, Route } from "react-router";
import SessionRouter from "./components/user/SessionRouter";
import RaffleManager from "./components/manager/raffle/RaffleManager";
import WwwSimManager from "./components/manager/wwwsim/WwwSimManager";
import ManageDashboard from './components/manager/ManageDashboard';

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
      <div className='w-full flex-grow'>
        <BrowserRouter>
          <Routes>
            <Route path="/manage" element={<ManageDashboard />} />
            <Route path="/manage/raffle" element={<RaffleManager />} />
            <Route path="/manage/raffle/:sessionId" element={<RaffleManager />} />
            <Route path="/manage/wwwsim" element={<WwwSimManager />} />
            <Route path="/manage/wwwsim/:sessionId" element={<WwwSimManager />} />
            <Route path="/:sessionId" element={<SessionRouter />} />
            <Route path="/" element={<SessionRouter />} />
          </Routes>
        </BrowserRouter>
      </div>

      {/* Footer with a note about the raffle functionality */}
      <div className='text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto'>
        <p>Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.</p>
      </div>
    </div>
  )
}
