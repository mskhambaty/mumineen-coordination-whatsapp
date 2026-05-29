"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Department = { id: string; name: string };

type ParsedEvent = {
  id: string;
  event_type: string;
  sender_alias: string | null;
  message_text: string | null;
  message_timestamp: string | null;
  ai_summary: string | null;
  confidence: number;
  applied: boolean;
};

export default function UploadPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<{ tasks_created: number; tasks_updated: number } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function fetchDepartments() {
      const res = await fetch("/api/departments", {
        headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
      });
      if (res.ok) {
        const data = await res.json();
        setDepartments(data);
      }
    }

    fetchDepartments();
  }, [router]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selectedDept) return;
    setLoading(true);
    setApplyResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("department_id", selectedDept);

      const res = await fetch("/api/transcripts/upload", {
        method: "POST",
        headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setUploadId(data.upload_id);
        setEvents(data.events);
        // Pre-select high confidence events
        const highConfidence = new Set<string>(
          data.events
            .filter((ev: ParsedEvent) => ev.confidence >= 0.7)
            .map((ev: ParsedEvent) => ev.id)
        );
        setSelectedEvents(highConfidence);
      } else {
        const err = await res.json();
        alert(err.error || "Upload failed");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!uploadId || selectedEvents.size === 0) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/transcripts/${uploadId}/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify({ event_ids: Array.from(selectedEvents) }),
      });

      if (res.ok) {
        const result = await res.json();
        setApplyResult(result);
        // Refresh events to show applied status
        const eventsRes = await fetch(`/api/transcripts/${uploadId}/events`, {
          headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
        });
        if (eventsRes.ok) {
          setEvents(await eventsRes.json());
        }
      }
    } catch (err) {
      console.error("Apply error:", err);
    } finally {
      setLoading(false);
    }
  }

  function toggleEvent(id: string) {
    const next = new Set(selectedEvents);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEvents(next);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-4">
              <Link href="/admin" className="text-blue-600 hover:underline">← Dashboard</Link>
              <h1 className="text-xl font-bold text-gray-900">Upload Transcript</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload Form */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Department</label>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select department...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Transcript File (.txt)</label>
              <input
                type="file"
                accept=".txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                className="mt-1 block w-full"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !file || !selectedDept}
              className="bg-blue-600 text-white px-6 py-2 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Parsing with AI..." : "Parse with AI"}
            </button>
          </form>
        </div>

        {/* Apply Result */}
        {applyResult && (
          <div className="bg-green-50 border border-green-200 p-4 rounded-lg mb-8">
            <p className="text-green-700 font-medium">
              ✅ {applyResult.tasks_created} tasks created, {applyResult.tasks_updated} tasks updated
            </p>
          </div>
        )}

        {/* Parsed Events */}
        {events.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">Parsed Events ({events.length})</h2>
              <button
                onClick={handleApply}
                disabled={loading || selectedEvents.size === 0}
                className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Apply Selected ({selectedEvents.size})
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Apply?</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sender</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">AI Summary</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {events.map((ev) => (
                    <tr key={ev.id} className={ev.confidence < 0.7 ? "bg-yellow-50" : ""}>
                      <td className="px-4 py-3">
                        {!ev.applied && (
                          <input
                            type="checkbox"
                            checked={selectedEvents.has(ev.id)}
                            onChange={() => toggleEvent(ev.id)}
                          />
                        )}
                        {ev.applied && <span className="text-green-600 text-sm">✓</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {ev.message_timestamp ? new Date(ev.message_timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">{ev.sender_alias ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{ev.message_text ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">{ev.ai_summary ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 text-xs rounded bg-gray-100">{ev.event_type}</span>
                      </td>
                      <td className="px-4 py-3 text-sm">{(ev.confidence * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
