import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

/**
 * WwwSimManager (ultra-minimal)
 *
 * Standard flow: Instructor opens page, we create a short-lived www-sim session.
 * If the page reloads, we pull the session id from the route params and display it as the join code.
 * Instructor doesn't otherwise interact with the id.
 *
 * Assumed endpoints (adjust later):
 *  - POST /api/sessions            -> { id, type: "www-sim" }
 *  - GET  /api/sessions/:id        -> { id }
 */
export default function WwwSimManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [displayCode, setDisplayCode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...opts,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    }

    async function run() {
      setBusy(true);
      setError(null);
      try {
        if (sessionId) {
          // validate/load existing session
          await api(`/api/sessions/${sessionId}`);
          if (!cancelled) setDisplayCode(sessionId);
        } else {
          // create new session
          const created = await api(`/api/sessions`, {
            method: "POST",
            body: JSON.stringify({ type: "www-sim" }),
          });
          if (!cancelled) {
            setDisplayCode(created.id);
            navigate(`/manage/wwwsim/${created.id}`, { replace: true });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [sessionId, navigate]);

  const studentJoinUrl = displayCode ? `${window.location.origin}/${displayCode}` : "";

  async function copyLink() {
    if (!studentJoinUrl) return;
    try { await navigator.clipboard.writeText(studentJoinUrl); } catch {}
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">HTTP/DNS Simulation — Instructor</h1>

      {busy && <p>Loading session…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {displayCode && (
        <div className="space-y-3 p-4 border rounded-2xl">
          <div className="flex items-center gap-3">
            <span className="text-sm">Join Code:</span>
            <code className="px-2 py-1 rounded bg-gray-100 font-mono text-lg">{displayCode}</code>
          </div>
          <div className="flex items-center gap-2">
            <input className="w-full px-3 py-2 border rounded-xl" value={studentJoinUrl} readOnly />
            <button onClick={copyLink} className="px-3 py-2 rounded-xl border">Copy</button>
          </div>
          <p className="text-xs text-gray-600">Share this URL or just the join code with students.</p>
        </div>
      )}
    </div>
  );
}
