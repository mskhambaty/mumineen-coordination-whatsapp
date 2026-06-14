"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clearAdminSession } from "@/lib/admin/client";

// access controls who sees a link, matching each page's gate (see
// src/lib/admin/access.ts and docs/access-control.md):
//  admin   = admin/leadership only
//  inbox   = admin/leadership or escalation/on-call support members
//  manage  = admin/leadership or department PM/HOD (AI-agent knowledge tools)
//  portal  = any signed-in portal user (committee or admin). Workspace pages are
//            "portal" but their content is dept-scoped server-side.
//  religious = admin/leadership or a dedicated religious monitor (isolated section)
//  any     = any signed-in user (same as portal in practice; kept for Profile)
type Access = "admin" | "inbox" | "manage" | "portal" | "religious" | "any";

type NavLink = { href: string; label: string; access: Access; exact?: boolean };

type DropdownGroup = {
  label: string;
  links: NavLink[];
};

type NavAccess = {
  isAdmin: boolean;
  isHelpdesk: boolean;
  isSupport: boolean;
  isManager: boolean;
  isIt: boolean;
  isInternal: boolean;
  isTransport: boolean;
  isAccommodations: boolean;
  isReligiousMonitor: boolean;
  // A monitor with NO other portal access — locked to the Religious section only (like helpdesk
  // is locked to the inbox). A committee/admin who is also a monitor is NOT religious-only.
  isReligiousOnly: boolean;
};

// Groups are organized by domain (the job a user shows up to do), not by whether a
// page touches the WhatsApp agent. Routes (href) and per-item access are unchanged.
const dropdownGroups: DropdownGroup[] = [
  {
    label: "Mumineen",
    links: [
      { href: "/admin/mumineen", label: "Roster", access: "portal" },
      { href: "/admin/registration", label: "Registration Analytics", access: "portal" },
      { href: "/admin/accommodations", label: "Accommodations", access: "portal" },
      { href: "/admin/parking", label: "Parking Passes", access: "portal" },
      { href: "/admin/niyaz", label: "Niyaz", access: "portal" },
    ],
  },
  {
    label: "Messaging",
    links: [
      { href: "/admin/relay-updates", label: "Relay Updates", access: "admin" },
      { href: "/admin/whatsapp-templates", label: "WhatsApp Templates", access: "admin" },
    ],
  },
  {
    label: "AI Agent",
    links: [
      { href: "/admin/prompt", label: "Prompts", access: "manage" },
      { href: "/admin/knowledge", label: "Knowledge Base", access: "portal" },
      { href: "/admin/knowledge-gaps", label: "Knowledge Gaps", access: "manage" },
      { href: "/admin/ashara", label: "Ashara Daily Content", access: "manage" },
      { href: "/admin/ollama-test", label: "Model Testing", access: "admin" },
    ],
  },
  {
    label: "Workspace",
    links: [
      { href: "/admin/tasks", label: "Tasks", access: "portal" },
      { href: "/admin/milestones", label: "Milestones", access: "portal" },
      { href: "/admin/department-digest", label: "Daily Digest", access: "portal" },
      { href: "/admin/upload", label: "Upload Transcripts", access: "portal" },
    ],
  },
  {
    label: "Member Management",
    links: [
      { href: "/admin/users", label: "Users", access: "portal" },
      { href: "/admin/departments", label: "Departments", access: "portal" },
      { href: "/admin/escalation", label: "Escalation & On-call", access: "portal" },
    ],
  },
];

// Inbox is the daily driver — promoted out of a dropdown to a top-level link.
const standaloneLinks: NavLink[] = [
  { href: "/admin", label: "Home", access: "portal", exact: true },
  { href: "/admin/conversations", label: "Inbox", access: "inbox" },
];

const trailingLinks: NavLink[] = [
  // Top-level (not a dropdown) so a dedicated monitor lands on it directly. Admins + monitors only.
  { href: "/admin/religious", label: "Religious", access: "religious" },
  { href: "/admin/profile", label: "Profile", access: "any" },
];

function readNavAccess(): NavAccess {
  const empty = { isAdmin: false, isHelpdesk: false, isSupport: false, isManager: false, isIt: false, isInternal: false, isTransport: false, isAccommodations: false, isReligiousMonitor: false, isReligiousOnly: false };
  if (typeof window === "undefined") return empty;

  try {
    const user = JSON.parse(window.localStorage.getItem("admin_user") ?? "null") as
      | { role?: string; global_role?: string; is_support?: boolean; is_manager?: boolean; is_it?: boolean; is_internal?: boolean; is_transport?: boolean; is_accommodations?: boolean; is_religious_monitor?: boolean }
      | null;
    const isAdmin = user?.role === "admin" || user?.global_role === "leadership_admin";
    const isReligiousMonitor = user?.is_religious_monitor === true;
    return {
      isAdmin,
      isHelpdesk: user?.role === "helpdesk",
      isSupport: user?.is_support === true,
      isManager: user?.is_manager === true,
      isIt: user?.is_it === true,
      isInternal: user?.is_internal === true,
      isTransport: user?.is_transport === true,
      isAccommodations: user?.is_accommodations === true,
      isReligiousMonitor,
      // Monitor with no other portal access (not admin/committee/helpdesk) → religious-only.
      isReligiousOnly: isReligiousMonitor && !isAdmin && user?.role !== "committee" && user?.role !== "helpdesk",
    };
  } catch {
    return empty;
  }
}

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return false;

    const stored = window.localStorage.getItem("admin_theme");
    return stored === "dark" || (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Role flags from the signed-in user, used to show only accessible links.
  const [access, setAccess] = useState(readNavAccess);
  const [pendingCount, setPendingCount] = useState(0);

  function canSee(itemAccess: Access) {
    if (itemAccess === "any") return true; // Profile, always
    // Religious section: admins and dedicated monitors. (Checked before the isolation gates so a
    // helpdesk-or-religious-only user still sees it.)
    if (itemAccess === "religious") return access.isAdmin || access.isReligiousMonitor;
    // A religious-monitor with no other portal access sees ONLY the Religious section — nothing
    // logistics/event/roster. (Mirrors how helpdesk is locked to the inbox.)
    if (access.isReligiousOnly) return false;
    // Helpdesk users see only the inbox and their own profile — nothing else.
    if (access.isHelpdesk) return itemAccess === "inbox";
    // The nav only renders for a signed-in portal user, so "portal" is always visible here;
    // the server still enforces the real gate per route.
    if (itemAccess === "portal") return true;
    if (itemAccess === "admin") return access.isAdmin;
    if (itemAccess === "inbox") return access.isAdmin || access.isSupport;
    return access.isAdmin || access.isManager || access.isSupport; // manage
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccess(readNavAccess());
  }, [pathname]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === "admin_user" || event.key === null) {
        setAccess(readNavAccess());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchPending() {
      try {
        const res = await fetch("/api/admin/escalations/breakdown");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setPendingCount(data.pending ?? 0);
        }
      } catch {}
    }
    fetchPending();
    const interval = setInterval(fetchPending, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (pathname === "/admin/login" || pathname === "/admin/reset-password") return null;

  function toggleTheme() {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("admin_theme", next ? "dark" : "light");
      return next;
    });
  }

  async function handleLogout() {
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
    } catch {
      // best-effort; local state is cleared regardless
    }
    clearAdminSession();
    router.push("/admin/login");
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  function isGroupActive(group: DropdownGroup) {
    return group.links.some((link) => isActive(link.href));
  }

  return (
    <nav ref={navRef} className="bg-white shadow-sm border-b dark:border-gray-800 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            {/* Official Ashara Mubaraka 1448H Chicago Relay Center logo (full-bleed art — show whole mark). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Ashara Mubaraka 1448H Chicago Relay Center"
              className="h-16 w-16 shrink-0 object-contain"
            />
            <h1 className="text-xl font-bold dark:text-gray-100">Ashara 1448H</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {standaloneLinks.filter((link) => canSee(link.access)).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  isActive(link.href, link.exact)
                    ? "text-blue-600 font-medium dark:text-blue-400"
                    : "text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
                }
              >
                {link.label}
                {link.href === "/admin/conversations" && pendingCount > 0 && (
                  <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </Link>
            ))}

            {dropdownGroups.map((group) => {
              const visibleLinks = group.links.filter((link) => canSee(link.access));
              if (visibleLinks.length === 0) return null;
              return (
              <div key={group.label} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenDropdown(openDropdown === group.label ? null : group.label)}
                  className={`flex items-center gap-1 ${
                    isGroupActive(group)
                      ? "text-blue-600 font-medium dark:text-blue-400"
                      : "text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
                  }`}
                >
                  {group.label}
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={openDropdown === group.label ? "M9 8L6 5L3 8" : "M3 4L6 7L9 4"} />
                  </svg>
                </button>

                {openDropdown === group.label && (
                  <div className="absolute left-0 top-full z-50 mt-2 w-44 rounded-md border bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {visibleLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpenDropdown(null)}
                        className={`block px-4 py-2 text-sm ${
                          isActive(link.href)
                            ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              );
            })}

            {trailingLinks.filter((link) => canSee(link.access)).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  isActive(link.href)
                    ? "text-blue-600 font-medium dark:text-blue-400"
                    : "text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
                }
              >
                {link.label}
              </Link>
            ))}

            <button
              onClick={handleLogout}
              className="text-gray-600 hover:text-red-600 dark:text-gray-300 dark:hover:text-red-400"
            >
              Logout
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
