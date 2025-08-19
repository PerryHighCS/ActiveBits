import React from "react";

/**
 * Instructions content shown in a modal after joining.
 */
export default function WwwSimInstructions() {
  return (
    <div className="space-y-5 text-sm leading-6 text-gray-800">
      {/* Quick Rules */}
      <section>
        <ul className="list-disc pl-5">
          <li>You will act as <span className="font-semibold">both</span> a Web Browser and a Web Server.</li>
          <li><span className="font-semibold">No talking</span> use the DNS in the Internet Simulator to share IP addresses and simulate network behavior.</li>
        </ul>
      </section>

      {/* Browser actions */}
      <section>
        <h4 className="font-semibold text-gray-700">As a Browser</h4>
        <ol className="list-decimal pl-5">
          <li>
            Look over your template for fragment tags.
          </li>
          <li>
            Check each fragment's <span className="font-mono font-semibold">src</span> attribute to find
            the <span className="font-semibold">hostname</span> and <span className="font-semibold">file name</span> you
            need to request to fill the fragment.
          </li>
          <li>
            <span className="font-semibold">DNS Lookup:</span> In the Internet Simulator, send a packet to
            your DNS server:
            <pre className="mt-1 p-2 bg-gray-100 border border-gray-200 rounded text-xs overflow-x-auto">
GET hostname
            </pre>
            Record the returned IP in the <span className="font-semibold">DNS Lookup Table</span> on
            your <span className="font-semibold">Browser</span> tab.
          </li>
          <li>
            <span className="font-semibold">HTTP Request:</span> Send to the host's IP:
            <pre className="mt-1 p-2 bg-gray-100 border border-gray-200 rounded text-xs overflow-x-auto">
GET fragmentName
            </pre>
          </li>
          <li>Paste the received fragment into your template. Repeat until your page is complete.</li>
          <li className="text-gray-700">No response? Re-query DNS; the IP may have changed.</li>
        </ol>
      </section>

      {/* Server actions */}
      <section>
        <h4 className="font-semibold text-gray-700">As a Server</h4>
        <ul className="list-disc pl-5">
          <li>Watch for incoming HTTP <span className="font-mono">GET</span> requests.</li>
          <li>If the request matches one of your files, reply with the correct fragment (use
            the <span className="font-semibold">Copy</span> button and paste into a response packet in the internet simulator).</li>
          <li>If the request is for a file you don't serve, respond with your <span className="font-semibold">404</span> message.</li>
        </ul>
      </section>

      {/* Finish */}
      <section>
        <h4 className="font-semibold text-gray-700">Finish</h4>
        <ul className="list-disc pl-5">
          <li>Verify every template fragment is filled correctly.</li>
          <li>Print the <span className="font-semibold">Browser</span> tab to PDF as documentation of completion.</li>
        </ul>
      </section>

      {/* Tiny Troubleshooting */}
      <details className="border border-gray-200 rounded">
        <summary className="cursor-pointer bg-gray-50 px-3 py-2 font-semibold text-gray-700">
          Troubleshooting
        </summary>
        <div className="px-3 py-2 space-y-2">
          <p><span className="font-semibold">No DNS reply?</span> Ensure you sent <span className="font-mono">GET hostname</span> to the DNS server's IP (check the router diagram).</p>
          <p><span className="font-semibold">Wrong content?</span> Double-check the exact file name from the fragment's <span className="font-mono">src</span> attribute.</p>
          <p><span className="font-semibold">Timeouts?</span> Re-lookup the IP and resend the request.</p>
        </div>
      </details>

    </div>
  );
}
