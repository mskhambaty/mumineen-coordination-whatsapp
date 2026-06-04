"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// access controls who sees a link, matching each page's gate:
//  admin    = admin/leadership only
//  inbox    = admin/leadership or escalation support members
//  manage   = admin/leadership or department PM/HOD
//  mumineen = admin/leadership or IT department members
//  any      = any signed-in user
type Access = "admin" | "inbox" | "manage" | "mumineen" | "any";

type NavLink = { href: string; label: string; access: Access; exact?: boolean };

type DropdownGroup = {
  label: string;
  links: NavLink[];
};

const dropdownGroups: DropdownGroup[] = [
  {
    label: "External",
    links: [
      { href: "/admin/conversations", label: "Inbox", access: "inbox" },
      { href: "/admin/prompt", label: "AI Prompt Management", access: "admin" },
      { href: "/admin/escalation", label: "Escalation/Support", access: "admin" },
      { href: "/admin/knowledge", label: "Vectorized Data for Agent", access: "manage" },
      { href: "/admin/mumineen", label: "Mumineen", access: "mumineen" },
    ],
  },
  {
    label: "Internal",
    links: [
      { href: "/admin/milestones", label: "Milestones", access: "manage" },
      { href: "/admin/tasks", label: "Task Management", access: "manage" },
      { href: "/admin/departments", label: "Departments", access: "admin" },
      { href: "/admin/users", label: "Users", access: "admin" },
      { href: "/admin/upload", label: "Upload Transcripts", access: "manage" },
    ],
  },
  {
    label: "Admin Settings",
    links: [
      { href: "/admin/ollama-test", label: "Ollama Test", access: "admin" },
    ],
  },
];

const standaloneLinks: NavLink[] = [
  { href: "/admin", label: "Home", access: "admin", exact: true },
];

const trailingLinks: NavLink[] = [
  { href: "/admin/profile", label: "Profile", access: "any" },
];

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
  const [access] = useState(() => {
    const empty = { isAdmin: false, isSupport: false, isManager: false, isIt: false };
    if (typeof window === "undefined") return empty;
    try {
      const user = JSON.parse(window.localStorage.getItem("admin_user") ?? "null") as
        | { role?: string; global_role?: string; is_support?: boolean; is_manager?: boolean; is_it?: boolean }
        | null;
      return {
        isAdmin: user?.role === "admin" || user?.global_role === "leadership_admin",
        isSupport: user?.is_support === true,
        isManager: user?.is_manager === true,
        isIt: user?.is_it === true,
      };
    } catch {
      return empty;
    }
  });

  function canSee(itemAccess: Access) {
    if (itemAccess === "any") return true;
    if (itemAccess === "admin") return access.isAdmin;
    if (itemAccess === "inbox") return access.isAdmin || access.isSupport;
    if (itemAccess === "mumineen") return access.isAdmin || access.isIt;
    return access.isAdmin || access.isManager; // manage
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (pathname === "/admin/login" || pathname === "/admin/reset-password") return null;

  function toggleTheme() {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("admin_theme", next ? "dark" : "light");
      return next;
    });
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
            {/* Full logo is portrait (emblem + text); crop to the circular emblem for the nav. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Relay Center Chicago"
              className="h-16 w-16 shrink-0 object-cover object-top"
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
              onClick={() => { localStorage.clear(); router.push("/admin/login"); }}
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
