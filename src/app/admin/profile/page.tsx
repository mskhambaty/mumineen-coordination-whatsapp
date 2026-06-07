"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch, readAdminUser } from "@/lib/admin/client";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(() => readAdminUser());
  const [displayName, setDisplayName] = useState(() => readAdminUser()?.display_name ?? "");
  const [email, setEmail] = useState(() => readAdminUser()?.email ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const isAdmin = user?.global_role === "leadership_admin" || user?.role === "admin";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!readAdminUser()) {
      router.push("/admin/login");
    }
  }, [router]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    setSavingName(true);
    setNameMsg(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = { display_name: displayName };
      if (isAdmin) payload.email = email;
      const res = await apiFetch("/api/admin/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to update profile");
      const next = { ...user, display_name: data.display_name, email: data.email };
      setUser(next);
      setEmail(data.email ?? "");
      localStorage.setItem("admin_user", JSON.stringify(next));
      setNameMsg("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordMsg(null);
    setError(null);
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: "New password and confirmation don't match." });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await apiFetch("/api/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({ ok: true, text: "Password updated." });
    } catch (err) {
      setPasswordMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to change password" });
    } finally {
      setSavingPassword(false);
    }
  }

  const roleLabel = user?.global_role === "leadership_admin" || user?.role === "admin"
    ? "Admin / Leadership"
    : (user?.global_role ? user.global_role.toUpperCase() : "Member");

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold">My Profile</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Update your details and password.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={saveName} className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Details</h2>
        <div className="mt-3 space-y-4">
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Display name
            <input value={displayName} onChange={(e) => { setDisplayName(e.target.value); setNameMsg(null); }} className={inputClass} />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Email{" "}
            <span className="text-gray-400">
              {isAdmin ? "(used to sign in)" : "(used to sign in — contact an admin to change)"}
            </span>
            {isAdmin ? (
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setNameMsg(null); }}
                className={inputClass}
              />
            ) : (
              <input value={user?.email ?? ""} disabled className={`${inputClass} cursor-not-allowed opacity-70`} />
            )}
          </label>
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Role
            <p className="mt-1 text-gray-500 dark:text-gray-400">{roleLabel}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {nameMsg && <span className="text-sm text-green-700 dark:text-green-400">{nameMsg}</span>}
          <button
            type="submit"
            disabled={savingName || !displayName.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {savingName ? "Saving..." : "Save"}
          </button>
        </div>
      </form>

      <form onSubmit={savePassword} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Change password</h2>
        <div className="mt-3 space-y-4">
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Current password
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            New password <span className="text-gray-400">(min 8 characters)</span>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Confirm new password
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {passwordMsg && (
            <span className={`text-sm ${passwordMsg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {passwordMsg.text}
            </span>
          )}
          <button
            type="submit"
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {savingPassword ? "Updating..." : "Update password"}
          </button>
        </div>
      </form>
    </main>
  );
}
