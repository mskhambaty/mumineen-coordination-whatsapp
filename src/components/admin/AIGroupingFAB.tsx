"use client";

import { useState } from "react";

type AIGroupingFABProps = {
  onClick: () => void;
};

export default function AIGroupingFAB({ onClick }: AIGroupingFABProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2"
    >
      {showTooltip && (
        <div className="rounded bg-gray-900 px-2 py-1 text-xs text-white shadow">
          AI Grouping
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-label="AI Grouping Suggestions"
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-500 text-white shadow-[0_4px_20px_rgba(99,102,241,0.4)] transition-transform hover:scale-105 active:scale-95"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
          <path d="M18 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" opacity="0.6" />
        </svg>
      </button>
    </div>
  );
}
