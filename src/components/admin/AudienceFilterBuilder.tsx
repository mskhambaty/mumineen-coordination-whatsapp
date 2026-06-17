"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryBuilder, formatQuery, type Field, type RuleGroupType } from "react-querybuilder";
import "react-querybuilder/dist/query-builder.css";

import { RecentSetValueEditor } from "@/components/admin/RecentSetValueEditor";
import { apiFetch } from "@/lib/admin/client";

// Shared custom-audience builder — the same react-querybuilder UI the WhatsApp template page uses,
// extracted so the survey composer can target an ad-hoc filter (e.g. "attending AND NOT rahat") and
// avoid re-surveying people already covered by a narrower group. Emits a RuleGroupType the caller
// stores verbatim; it's validated/evaluated server-side by audience-filter's runFilter.

type CatalogField = { key: string; label: string; group: string; type: string; operators: string[]; values: string[] };
type RqbField = Field & { setField?: boolean };

const OP_LABELS: Record<string, string> = {
  "=": "is", "!=": "is not", in: "is any of", notIn: "is none of", contains: "contains",
  null: "is empty", notNull: "is not empty", "<": "before / <", "<=": "≤", ">": "after / >", ">=": "≥", between: "between",
};

export function AudienceFilterBuilder({
  query,
  onChange,
}: {
  query: RuleGroupType;
  onChange: (q: RuleGroupType) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogField[]>([]);

  useEffect(() => {
    void (async () => {
      const f = await apiFetch("/api/admin/templates/audience-fields");
      if (f.ok) {
        const fd = await f.json();
        setCatalog((fd.fields as CatalogField[]) ?? []);
      }
    })();
  }, []);

  const rqbFields: RqbField[] = useMemo(
    () =>
      catalog.map((f): RqbField => {
        const base = { name: f.key, label: `${f.group}: ${f.label}`, operators: f.operators.map((o) => ({ name: o, label: OP_LABELS[o] ?? o })) };
        if (f.type === "bool") return { ...base, valueEditorType: "select" as const, values: [{ name: "true", label: "Yes" }, { name: "false", label: "No" }], defaultValue: "true" };
        if (f.type === "enum") return { ...base, valueEditorType: "multiselect" as const, values: f.values.map((v) => ({ name: v, label: v })) };
        if (f.type === "set") return { ...base, setField: true, values: f.values.map((v) => ({ name: v, label: v })) };
        if (f.type === "number") return { ...base, inputType: "number" };
        if (f.type === "date") return { ...base, inputType: "date" };
        return base;
      }),
    [catalog],
  );

  const summary = useMemo(() => {
    try {
      return formatQuery(query, { format: "natural_language", fields: rqbFields }) || "everyone in the roster";
    } catch {
      return "everyone in the roster";
    }
  }, [query, rqbFields]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Build a custom audience. Use <span className="font-medium">NOT</span> groups to exclude people
        already covered by another form (e.g. attending <span className="font-medium">AND NOT</span> rahat).
      </p>
      {rqbFields.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">Loading filter fields…</p>
      ) : (
        <QueryBuilder fields={rqbFields} query={query} onQueryChange={onChange} controlElements={{ valueEditor: RecentSetValueEditor }} showNotToggle listsAsArrays />
      )}
      <p className="text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold">Targets:</span> {summary}
      </p>
    </div>
  );
}
