// Hand-rolled vertical bar chart (no chart lib): one bar per day, scaled to the max value, with a
// hover tooltip and M/D labels. Takes simple { date: "YYYY-MM-DD"; count } pairs so callers can feed
// either a daily series or a cumulative one. Used by the registration analytics "Registrations Over
// Time" panel and the niyaz event-detail "Responses over time" card.
export default function VBars({
  data,
  color = "bg-blue-500",
  height = 64,
  onBarClick,
}: {
  data: { date: string; count: number }[];
  color?: string;
  height?: number;
  onBarClick?: (date: string) => void;
}) {
  if (data.length === 0)
    return <p className="py-6 text-center text-sm text-gray-400">No data yet</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const fmtDate = (d: string) => {
    const [, m, day] = d.split("-");
    return `${parseInt(m)}/${parseInt(day)}`;
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <div className="flex min-w-0 items-end gap-0.5" style={{ height: `${height + 20}px` }}>
        {data.map((d) => (
          <div
            key={d.date}
            role={onBarClick ? "button" : undefined}
            tabIndex={onBarClick ? 0 : undefined}
            onClick={() => onBarClick?.(d.date)}
            onKeyDown={(e) => e.key === "Enter" && onBarClick?.(d.date)}
            className={`group relative flex flex-1 flex-col items-center justify-end ${onBarClick ? "cursor-pointer" : ""}`}
            style={{ height: `${height + 20}px` }}
          >
            <div
              className={`w-full min-h-[2px] ${color} rounded-t-sm opacity-75 transition-opacity group-hover:opacity-100`}
              style={{ height: `${(d.count / max) * height}px` }}
            />
            <div className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block whitespace-nowrap">
              {fmtDate(d.date)}: {d.count}
            </div>
            {data.length <= 20 && (
              <span className="mt-0.5 text-[9px] text-gray-400 leading-none">
                {fmtDate(d.date)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
