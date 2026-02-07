import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudentTemplate } from '../../wwwSimTypes.js'

interface DNSLookupTableProps {
  template: StudentTemplate | null
  sessionId?: string
  onChange?: (dnsMap: Record<string, string>) => void
}

export default function DNSLookupTable({ template, sessionId, onChange }: DNSLookupTableProps) {
  const hostnames = useMemo(() => {
    if (!template || !Array.isArray(template.fragments)) return []
    const set = new Set<string>()
    template.fragments.forEach((fragment) => {
      if (!fragment.url) return
      try {
        const url = fragment.url.startsWith('//') ? new URL('http:' + fragment.url) : new URL(fragment.url)
        if (url.hostname) set.add(url.hostname)
      } catch {
        // Ignore malformed URLs.
      }
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [template])

  const storageKey = sessionId ? `${sessionId}-dns` : null

  const [dnsMap, setDnsMap] = useState<Record<string, string>>({})
  const loaded = useRef(false)

  useEffect(() => {
    loaded.current = false

    if (!storageKey || hostnames.length === 0) {
      setDnsMap({})
      return
    }

    try {
      const stored = localStorage.getItem(storageKey)
      const parsed = stored ? (JSON.parse(stored) as Record<string, unknown>) : {}
      const next: Record<string, string> = {}
      hostnames.forEach((hostname) => {
        next[hostname] = typeof parsed[hostname] === 'string' ? parsed[hostname] : ''
      })
      setDnsMap(next)
    } catch {
      const next: Record<string, string> = {}
      hostnames.forEach((hostname) => {
        next[hostname] = ''
      })
      setDnsMap(next)
    } finally {
      loaded.current = true
    }
  }, [storageKey, hostnames])

  useEffect(() => {
    if (!loaded.current) return

    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(dnsMap))
      } catch {
        // Ignore write errors (for example, storage quota exceeded).
      }
    }

    onChange?.(dnsMap)
  }, [dnsMap, onChange, storageKey])

  return (
    <div className="border border-gray-300 rounded mx-auto">
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
            {hostnames.map((host) => (
              <tr key={host} className="odd:bg-white even:bg-gray-50 hover:bg-gray-100 border-t border-gray-300">
                <td className="px-3 py-2 border-r border-gray-300">{host}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="text"
                    className="text-center border border-gray-300 rounded px-2 py-1 text-sm w-max-50"
                    value={dnsMap[host] || ''}
                    onChange={(event) => setDnsMap((prev) => ({ ...prev, [host]: event.target.value }))}
                    placeholder="Enter IP"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
