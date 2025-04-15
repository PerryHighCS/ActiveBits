import { useState } from 'react'
import { BrowserRouter, Routes, Route } from "react-router";
import TicketPage from "./components/tickets/TicketPage";
import RaffleManager from "./components/manager/RaffleManager";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TicketPage />} />
        <Route path="/manage" element={<RaffleManager />} />
      </Routes>
    </BrowserRouter>
  )
}
