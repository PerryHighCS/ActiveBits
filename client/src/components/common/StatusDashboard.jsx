import React, { useEffect, useMemo, useRef, useState } from "react";

function fmtInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "-";
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const fixed = v < 10 ? v.toFixed(1) : v.toFixed(0);
  return `${fixed} ${units[i]}`;
}

export default function StatusDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);
  const lastUpdatedRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const json = await res.json();
        if (!mounted) return;
        setData(json);
        setError("");
        lastUpdatedRef.current = new Date();
      } catch (e) {
        if (!mounted) return;
        setError(String(e?.message || e));
      }
    }
    load();
    const id = setInterval(() => { if (!paused) load(); }, intervalMs);
    return () => { mounted = false; clearInterval(id); };
  }, [intervalMs, paused]);

  const byTypeEntries = useMemo(() => {
    const byType = data?.sessions?.byType || {};
    return Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const sessionRows = useMemo(() => {
    const list = data?.sessions?.list || [];
    return [...list]
      .sort((a, b) => {
        const as = a.lastActivity ? Date.parse(a.lastActivity) : 0;
        const bs = b.lastActivity ? Date.parse(b.lastActivity) : 0;
        return bs - as;
      })
      .map((s) => ({
        id: s.id,
        type: s.type || "-",
        socketCount: s.socketCount || 0,
        lastActivity: s.lastActivity || "-",
        expiresAt: s.expiresAt || "-",
        ttl: typeof s.ttlRemainingMs === "number" ? `${Math.max(0, Math.floor(s.ttlRemainingMs/1000))}s` : "-",
        approxBytes: s.approxBytes,
      }));
  }, [data]);

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: "0 auto", background: "#f9fafb", color: "#1f2937", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif" }}>
      <header style={{ borderBottom: "1px solid #e5e7eb", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 18, margin: 0, color: "#111827" }}>ActiveBits Status</h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Last update: {lastUpdatedRef.current ? lastUpdatedRef.current.toLocaleTimeString() : "—"}
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "#6b7280" }}>Refresh:</label>
            <select value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))}
              style={{ background: "#fff", color: "#1f2937", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px" }}>
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
            {!paused ? (
              <button onClick={() => setPaused(true)} style={{ background: "#fff", color: "#1f2937", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Pause</button>
            ) : (
              <button onClick={() => setPaused(false)} style={{ background: "#fff", color: "#1f2937", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Resume</button>
            )}
          </div>
        </div>
        <div style={{ width: "100%", marginTop: 8 }}>
          <div style={{ minHeight: 18, color: "#dc2626" }}>{error}</div>
        </div>
      </header>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Mode</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{data?.storage?.mode || "-"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>TTL: {data?.storage?.ttlMs ? `${Math.round(data.storage.ttlMs/1000)}s` : "-"}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Uptime</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{fmtInt(data?.process?.uptimeSeconds)}s</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Node <code>{data?.process?.node || "-"}</code></div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>WS Clients</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{fmtInt(data?.websocket?.connectedClients)}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Connected sockets</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>RSS Memory</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{fmtBytes(data?.process?.memory?.rss)}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Heap {fmtBytes(data?.process?.memory?.heapUsed)} / {fmtBytes(data?.process?.memory?.heapTotal)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Sessions</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{fmtInt(data?.sessions?.count)}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Approx size {fmtBytes(data?.sessions?.approxTotalBytes)}</div>
        </div>
      </div>

      {/* By type + Valkey */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Sessions by Type</h3>
          <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
            {byTypeEntries.length > 0 ? (
              byTypeEntries.map(([k, v]) => (
                <React.Fragment key={k}>
                  <div style={{ color: "#6b7280" }}>{k}</div>
                  <div style={{ color: "#111827" }}>{fmtInt(v)}</div>
                </React.Fragment>
              ))
            ) : (
              <>
                <div style={{ color: "#6b7280" }}>none</div>
                <div style={{ color: "#111827" }}>0</div>
              </>
            )}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Valkey</h3>
          <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
            {data?.valkey ? (
              data.valkey.error ? (
                <>
                  <div style={{ color: "#6b7280" }}>error</div>
                  <div style={{ color: "#dc2626" }}>{String(data.valkey.error)}</div>
                </>
              ) : (
                <>
                  <div style={{ color: "#6b7280" }}>ping</div>
                  <div style={{ color: "#111827" }}><code>{data.valkey.ping}</code></div>
                  <div style={{ color: "#6b7280" }}>dbsize</div>
                  <div style={{ color: "#111827" }}>{fmtInt(data.valkey.dbsize)}</div>
                  <div style={{ color: "#6b7280" }}>used_memory</div>
                  <div style={{ color: "#111827" }}>{fmtBytes(Number(data.valkey.memory?.used_memory))} ({data.valkey.memory?.used_memory_human || "-"})</div>
                  <div style={{ color: "#6b7280" }}>used_memory_rss</div>
                  <div style={{ color: "#111827" }}>{fmtBytes(Number(data.valkey.memory?.used_memory_rss))} ({data.valkey.memory?.used_memory_rss_human || "-"})</div>
                </>
              )
            ) : (
              <>
                <div style={{ color: "#6b7280" }}>info</div>
                <div style={{ color: "#111827" }}>not using Valkey</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sessions table */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Active Sessions</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Session ID</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Type</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Sockets</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Last Activity</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Expires At</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>TTL</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Approx Size</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.length > 0 ? (
                sessionRows.map((s) => (
                  <tr key={s.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#111827" }}><code>{s.id}</code></td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#111827" }}>{s.type}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: s.socketCount > 0 ? "#059669" : "#111827" }}>{fmtInt(s.socketCount)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#111827" }}>{s.lastActivity}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#111827" }}>{s.expiresAt}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#111827" }}>{s.ttl}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#111827" }}>{fmtBytes(s.approxBytes)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontSize: 12, color: "#6b7280" }}>No sessions</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
