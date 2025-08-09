import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Button from "@src/components/ui/Button";

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
    const [copied, setCopied] = useState(false);

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
                    await api(`/api/session/${sessionId}`);
                    if (!cancelled) setDisplayCode(sessionId);
                } else {
                    // create new session
                    const created = await api(`/api/www-sim/create`, {
                        method: "POST",
                        body: JSON.stringify({ type: "www-sim" }),
                    });
                    if (!cancelled) {
                        setDisplayCode(created.id);
                        navigate(`/manage/www-sim/${created.id}`, { replace: true });
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
        try {
            await navigator.clipboard.writeText(studentJoinUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { }
    }

    return  (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-bold">Web Simulation: HTTP & DNS Protocols</h1>
        {displayCode && (
          <>
            <div className="flex items-center gap-2 w-fit">
                <input
                value={studentJoinUrl}
                readOnly
                onFocus={(e) => e.target.select()}
                className="field-sizing-content w-100 border border-gray-300 rounded px-2 py-1 text-sm font-mono bg-gray-50"
                />
              <Button onClick={copyLink} variant="outline">
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Join Code:</span>
              <code className="px-2 py-1 rounded bg-gray-100 font-mono text-lg">{displayCode}</code>
            </div>
          </>
        )}
      </div>

      {busy && <p>Loading session…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

    </div>
  );
}