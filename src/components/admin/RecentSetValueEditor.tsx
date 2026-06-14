"use client";

import { ValueEditor, type ValueEditorProps } from "react-querybuilder";

import { FILTERABLE_AGENT_TOOLS } from "@/lib/agent/tool-names";

// Friendly labels for the AI-tool option names (the wire value stays the raw tool name so it matches
// the timestamp-map keys the filter evaluates against). Template codes have no friendly map — shown
// as-is, matching the console's template names.
const TOOL_LABELS: Record<string, string> = Object.fromEntries(FILTERABLE_AGENT_TOOLS.map((t) => [t.name, t.label]));

type SetValue = { items: string[]; withinHours: number | null };

function parseValue(v: unknown): SetValue {
  const o = (v ?? {}) as { items?: unknown; withinHours?: unknown };
  return {
    items: Array.isArray(o.items) ? o.items.map((x) => String(x)) : [],
    withinHours: typeof o.withinHours === "number" && o.withinHours > 0 ? o.withinHours : null,
  };
}

const input = "rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900";

// Custom react-querybuilder value editor for `set` fields (AI tool usage, Template history). Renders a
// multiselect of the field's options plus a "within last N hours" box (blank = ever), producing the
// compound value { items, withinHours } the audience engine evaluates. For every other field type it
// defers to rqb's stock ValueEditor, so it's safe to register globally via controlElements.
export function RecentSetValueEditor(props: ValueEditorProps) {
  const fieldData = props.fieldData as { setField?: boolean; values?: { name: string; label: string }[] };
  if (!fieldData.setField) return <ValueEditor {...props} />;

  const value = parseValue(props.value);
  const options = fieldData.values ?? [];
  const update = (next: SetValue) => props.handleOnChange(next);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        multiple
        value={value.items}
        onChange={(e) => update({ ...value, items: Array.from(e.target.selectedOptions, (o) => o.value) })}
        className={`${input} min-w-[12rem] max-h-28`}
      >
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {TOOL_LABELS[o.name] ?? o.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-gray-500">within last</span>
      <input
        type="number"
        min={1}
        step={1}
        value={value.withinHours ?? ""}
        placeholder="ever"
        onChange={(e) => {
          const n = Number(e.target.value);
          update({ ...value, withinHours: e.target.value !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null });
        }}
        className={`${input} w-20`}
      />
      <span className="text-xs text-gray-500">hours (blank = ever)</span>
    </span>
  );
}
