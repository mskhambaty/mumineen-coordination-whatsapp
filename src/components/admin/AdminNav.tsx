"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type DropdownGroup = {
  label: string;
  links: { href: string; label: string }[];
};

const dropdownGroups: DropdownGroup[] = [
  {
    label: "WhatsApp",
    links: [
      { href: "/admin/conversations", label: "Inbox" },
      { href: "/admin/prompt", label: "Prompt" },
    ],
  },
  {
    label: "Project",
    links: [
      { href: "/admin/milestones", label: "Milestones" },
      { href: "/admin/tasks", label: "Task Management" },
    ],
  },
];

const standaloneLinks = [
  { href: "/admin", label: "Home", exact: true },
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/users", label: "Users" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("admin_theme");
    if (stored === "dark" || (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDarkMode(true);
    }
  }, []);

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

  if (pathname === "/admin/login") return null;

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
          <h1 className="text-xl font-bold dark:text-gray-100">Ashara 1448H</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {standaloneLinks.map((link) => (
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

            {dropdownGroups.map((group) => (
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
                    {group.links.map((link) => (
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
