"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const navLinks = [
  { href: "/admin", label: "Home", exact: true },
  { href: "/admin/conversations", label: "Inbox" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/kanban", label: "Kanban" },
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/prompt", label: "Prompt" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("admin_theme");
    if (stored === "dark" || (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDarkMode(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  if (pathname === "/admin/login") return null;

  function toggleTheme() {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("admin_theme", next ? "dark" : "light");
      return next;
    });
  }

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <nav className="bg-white shadow-sm border-b dark:border-gray-800 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-xl font-bold dark:text-gray-100">Ashara 1448H Dashboard</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {navLinks.map((link) => (
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
