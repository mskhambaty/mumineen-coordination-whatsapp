"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DeptSummary = {
  department_name: string;
  department_id: string;
  open: number;
  in_progress: number;
  blocked: number;
  complete: number;
  total: number;
};

export default function AdminDashboard() {
  const [summaries, setSummaries] = useState<DeptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function fetchData() {
      try {
        const res = await fetch("/api/departments/summary/all", {
          headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
        });
        if (res.ok) {
          const data = await res.json();
          setSummaries(data);
        }
      } catch (err) {
        console.error("Failed to fetch summary:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [router]);

  const totalDepts = summaries.length;
  const totalTasks = summaries.reduce((sum, s) => sum + s.total, 0);
  const openTasks = summaries.reduce((sum, s) => sum + s.open, 0);
  const blockedTasks = summaries.reduce((sum, s) => sum + s.blocked, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold text-gray-900">Ashara 1448H Dashboard</h1>
            <div className="flex space-x-4">
              <Link href="/admin" className="text-blue-600 font-medium">Home</Link>
              <Link href="/admin/kanban" className="text-gray-600 hover:text-blue-600">Kanban</Link>
              <Link href="/admin/upload" className="text-gray-600 hover:text-blue-600">Upload</Link>
              <Link href="/admin/users" className="text-gray-600 hover:text-blue-600">Users</Link>
              <button
                onClick={() => { localStorage.clear(); router.push("/admin/login"); }}
                className="text-gray-600 hover:text-red-600"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Count Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500">Total Departments</p>
            <p className="text-3xl font-bold text-gray-900">{totalDepts}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500">Total Tasks</p>
            <p className="text-3xl font-bold text-gray-900">{totalTasks}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500">Open Tasks</p>
            <p className="text-3xl font-bold text-blue-600">{openTasks}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500">Blocked Tasks</p>
            <p className="text-3xl font-bold text-red-600">{blockedTasks}</p>
          </div>
        </div>

        {/* Departments Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">All Departments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Open</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">In Progress</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Blocked</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Complete</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {summaries.map((dept) => (
                  <tr key={dept.department_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/departments/${dept.department_id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {dept.department_name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-center text-gray-600">{dept.open}</td>
                    <td className="px-6 py-4 text-center text-blue-600">{dept.in_progress}</td>
                    <td className="px-6 py-4 text-center text-red-600">{dept.blocked}</td>
                    <td className="px-6 py-4 text-center text-green-600">{dept.complete}</td>
                    <td className="px-6 py-4 text-center font-medium">{dept.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
