import { useState } from 'react'
import { BrowserRouter, Routes, Route } from "react-router";
import TicketPage from "./components/tickets/TicketPage";
import RaffleManager from "./components/manager/RaffleManager";

export default function App() {
  return (
    <div className='w-full flex flex-col items-center min-h-screen pt-10 px-10'>
      <div className='w-full flex-grow'>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<TicketPage />} />
            <Route path="/manage" element={<RaffleManager />} />
          </Routes>
        </BrowserRouter>
      </div>
      <div className='text-center text-sm text-gray-500 mt-4 w-full bg-white border-t border-gray-300 p-4 mx-auto'>
        <p>Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.</p>
      </div>
    </div>
  )
}
