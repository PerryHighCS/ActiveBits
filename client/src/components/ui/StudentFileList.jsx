import React from "react";

export default function StudentFragmentList({ fragments, hostname }) {
    if (!fragments?.length) return <div className="text-gray-500">No hosted files.</div>;

    return (
        <div className="space-y-2">
            <h2 className="text-lg font-semibold">Hosted Files</h2>
            <ul className="space-y-1">
                {fragments.map(({ fileName, fragment }) => (
                    <li key={fileName} className="border rounded p-2 bg-gray-50">
                        <p className="font-mono text-sm text-blue-900">
                            <strong>/{fileName}</strong>
                        </p>
                        <p className="text-sm text-gray-600 italic">
                            Contains: {fragment.slice(0, 100)}{fragment.length > 100 ? "…" : ""}
                        </p>
                    </li>
                ))}
            </ul>
        </div>
    );
}
