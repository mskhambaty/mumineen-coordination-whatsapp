// Small circled-"i" info icon with a native tooltip (title). Used to annotate computed columns/stats.
export default function InfoIcon({ label }: { label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className="inline-flex cursor-help text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="8" cy="5" r="0.9" fill="currentColor" />
        <path d="M8 7v4.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </span>
  );
}
