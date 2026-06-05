import type { WaTemplate, WaTemplateComponent } from "@/lib/meta/whatsapp";

// A UI-friendly description of a template's fillable variables, derived from its raw components.
export type TemplateDescriptor = {
  name: string;
  language: string;
  category: string | null;
  bodyText: string | null;
  bodyVarCount: number;
  header: { format: string; hasVar: boolean } | null; // format: TEXT | IMAGE | VIDEO | DOCUMENT
  urlButtons: { index: number; text: string | null; hasVar: boolean }[];
};

function countVars(text: string | undefined | null): number {
  if (!text) return 0;
  const nums = (text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/[^\d]/g, "")));
  return nums.length ? Math.max(...nums) : 0;
}

function find(components: WaTemplateComponent[] | undefined, type: string): WaTemplateComponent | undefined {
  return (components ?? []).find((c) => c.type?.toUpperCase() === type);
}

// Summarize a raw Meta template into the variables the composer must collect.
export function describeTemplate(tpl: WaTemplate): TemplateDescriptor {
  const body = find(tpl.components, "BODY");
  const header = find(tpl.components, "HEADER");
  const buttonsComp = find(tpl.components, "BUTTONS");

  const urlButtons = (buttonsComp?.buttons ?? [])
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type?.toUpperCase() === "URL")
    .map(({ b, index }) => ({ index, text: b.text ?? null, hasVar: /\{\{\s*\d+\s*\}\}/.test(b.url ?? "") }));

  return {
    name: tpl.name,
    language: tpl.language,
    category: tpl.category ?? null,
    bodyText: body?.text ?? null,
    bodyVarCount: countVars(body?.text),
    header: header ? { format: (header.format ?? "TEXT").toUpperCase(), hasVar: countVars(header.text) > 0 || (header.format ?? "TEXT").toUpperCase() !== "TEXT" } : null,
    urlButtons,
  };
}

export type SendComponentInputs = {
  bodyParams?: string[];
  headerText?: string | null;
  headerMediaUrl?: string | null;
  urlButtonParam?: string | null;
};

// Build the Meta `components` array for a template send from the collected inputs + descriptor.
// v1: BODY text vars, TEXT header var, media header via URL, and one dynamic URL-button suffix.
export function buildSendComponents(inputs: SendComponentInputs, desc: TemplateDescriptor): unknown[] {
  const components: unknown[] = [];

  if (desc.header) {
    if (desc.header.format === "TEXT") {
      if (inputs.headerText) {
        components.push({ type: "header", parameters: [{ type: "text", text: inputs.headerText }] });
      }
    } else if (inputs.headerMediaUrl) {
      const fmt = desc.header.format.toLowerCase(); // image | video | document
      components.push({ type: "header", parameters: [{ type: fmt, [fmt]: { link: inputs.headerMediaUrl } }] });
    }
  }

  if (desc.bodyVarCount > 0) {
    const params = (inputs.bodyParams ?? []).slice(0, desc.bodyVarCount).map((text) => ({ type: "text", text: text ?? "" }));
    components.push({ type: "body", parameters: params });
  }

  const dynamicUrlBtn = desc.urlButtons.find((b) => b.hasVar);
  if (dynamicUrlBtn && inputs.urlButtonParam) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(dynamicUrlBtn.index),
      parameters: [{ type: "text", text: inputs.urlButtonParam }],
    });
  }

  return components;
}

// Render a preview of the body with {{n}} substituted by the provided params.
export function previewBody(bodyText: string | null, bodyParams: string[]): string {
  if (!bodyText) return "";
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => bodyParams[Number(n) - 1] ?? `{{${n}}}`);
}
