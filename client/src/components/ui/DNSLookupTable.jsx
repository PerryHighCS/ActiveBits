import React, { useMemo, useState, useEffect } from "react";

export default function DNSLookupTable({ template, initialDns = {}, onChange }) {
  // Extract unique hostnames from template.fragments
  const hostnames = useMemo(() => {
    if (!template || !Array.isArray(template.fragments)) return [];
    const set = new Set();
    template.fragments.forEach(f => {
      if (f.url) {
        try {
          const u = f.url.startsWith("//") ? new URL("http:" + f.url) : new URL(f.url);
          if (u.hostname) set.add(u.hostname);
        } catch {
          // Ignore malformed URLs
        }
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [template]);

  // DNS mapping state
  const [dnsMap, setDnsMap] = useState({});

  // Initialize/refresh dnsMap when hostnames change
  useEffect(() => {
    setDnsMap(prev => {
      const next = {};
      hostnames.forEach(h => {
        next[h] = prev[h] ?? initialDns[h] ?? "";
      });
      return next;
    });
  }, [hostnames, initialDns]);

  // Notify parent on change
  useEffect(() => {
    if (onChange) onChange(dnsMap);
  }, [dnsMap, onChange]);

  return (
    <div className="w-full lg:w-1/3 border border-gray-300 rounded mx-auto">
      <div className="bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 border-b border-gray-300 rounded-t">
        DNS Lookup Table
      </div>
      {hostnames.length === 0 ? (
        <p className="p-3 text-center text-sm text-gray-500">No hostnames found</p>
      ) : (
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-sm font-semibold border-r border-gray-300">Hostname</th>
              <th className="px-3 py-2 text-center text-sm font-semibold">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {hostnames.map(host => (
              <tr key={host} className="odd:bg-white even:bg-gray-50 hover:bg-gray-100 border-t border-gray-300">
                <td className="px-3 py-2 border-r border-gray-300">{host}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="text"
                    className="text-center border border-gray-300 rounded px-2 py-1 text-sm w-50"
                    value={dnsMap[host] || ""}
                    onChange={e =>
                      setDnsMap(prev => ({ ...prev, [host]: e.target.value }))
                    }
                    placeholder="Enter IP"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
