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
  milestone_count: number;
  total_budget: number;
  avg_completion: number;
  open_issues: number;
};

type Milestone = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  percent_complete: number;
  department_id: string;
  departments: { name: string } | null;
};

export default function AdminDashboard() {
  const [summaries, setSummaries] = useState<DeptSummary[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function fetchData() {
      try {
        const [summaryRes, milestonesRes] = await Promise.all([
          fetch("/api/departments/summary/all", { headers: { "x-admin-key": adminKey } }),
          fetch("/api/milestones", { headers: { "x-admin-key": adminKey, "Content-Type": "application/json" } }),
        ]);
        if (summaryRes.ok) setSummaries(await summaryRes.json());
        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
      } catch (err) {
        console.error("Failed to fetch summary:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [router, adminKey]);

  const totalDepts = summaries.length;
  const totalTasks = summaries.reduce((sum, s) => sum + s.total, 0);
  const openTasks = summaries.reduce((sum, s) => sum + s.open, 0);
  const blockedTasks = summaries.reduce((sum, s) => sum + s.blocked, 0);
  const totalMilestones = summaries.reduce((sum, s) => sum + (s.milestone_count ?? 0), 0);
  const totalBudget = summaries.reduce((sum, s) => sum + (s.total_budget ?? 0), 0);
  const avgCompletion = totalMilestones > 0
    ? Math.round(milestones.reduce((sum, m) => sum + m.percent_complete, 0) / milestones.length)
    : 0;
  const openIssues = summaries.reduce((sum, s) => sum + (s.open_issues ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Departments</p>
          <p className="text-3xl font-bold">{totalDepts}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
          <p className="text-3xl font-bold">{totalTasks}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Open Tasks</p>
          <p className="text-3xl font-bold text-blue-600">{openTasks}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Blocked Tasks</p>
          <p className="text-3xl font-bold text-red-600">{blockedTasks}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Milestones</p>
          <p className="text-3xl font-bold text-teal-600">{totalMilestones}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Budget</p>
          <p className="text-3xl font-bold">${totalBudget.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Completion</p>
          <p className="text-3xl font-bold text-teal-600">{avgCompletion}%</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Open Issues</p>
          <p className="text-3xl font-bold text-orange-600">{openIssues}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-8 dark:bg-gray-900 dark:border-gray-800">
        <div className="px-6 py-4 border-b dark:border-gray-800">
          <h2 className="text-lg font-semibold">All Departments</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Name</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Open</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">In Progress</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Blocked</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Complete</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Issues</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Budget</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {summaries.map((dept) => (
                <tr key={dept.department_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-6 py-4">
                    <Link
                      href={`/admin/departments/${dept.department_id}`}
                      className="text-blue-600 hover:underline font-medium dark:text-blue-400"
                    >
                      {dept.department_name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-center text-gray-600 dark:text-gray-400">{dept.open}</td>
                  <td className="px-6 py-4 text-center text-blue-600 dark:text-blue-400">{dept.in_progress}</td>
                  <td className="px-6 py-4 text-center text-red-600 dark:text-red-400">{dept.blocked}</td>
                  <td className="px-6 py-4 text-center text-green-600 dark:text-green-400">{dept.complete}</td>
                  <td className="px-6 py-4 text-center text-orange-600 dark:text-orange-400">{dept.open_issues ?? 0}</td>
                  <td className="px-6 py-4 text-center font-medium">${(dept.total_budget ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {milestones.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-6 py-4 border-b dark:border-gray-800">
            <h2 className="text-lg font-semibold">Milestones Overview</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Milestone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Department</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Budget</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Progress</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {milestones.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-6 py-4 font-medium">{m.title}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{m.departments?.name ?? "—"}</td>
                    <td className="px-6 py-4 text-center">{m.budget != null ? `$${Number(m.budget).toLocaleString()}` : "—"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                          <div
                            className={`h-2 rounded-full ${
                              m.percent_complete >= 100 ? "bg-green-500" :
                              m.percent_complete >= 50 ? "bg-teal-500" :
                              "bg-blue-500"
                            }`}
                            style={{ width: `${Math.min(100, m.percent_complete)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{m.percent_complete}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        m.status === "complete" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" :
                        m.status === "blocked" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
                        m.status === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" :
                        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      }`}>
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
