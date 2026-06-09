import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/util/csv";

describe("parseCsv", () => {
  it("parses quoted Google Sheet CSV rows with embedded newlines", () => {
    const rows = parseCsv('Name,Notes,Phone\n"Hotel A","Line 1\nLine 2",630-000-0000\n');

    expect(rows).toEqual([
      ["Name", "Notes", "Phone"],
      ["Hotel A", "Line 1\nLine 2", "630-000-0000"],
    ]);
  });

  it("handles escaped double-quotes and skips blank lines", () => {
    const rows = parseCsv('a,"b ""quoted"" c"\n\n d , e \n');

    expect(rows).toEqual([
      ["a", 'b "quoted" c'],
      [" d ", " e "],
    ]);
  });
});
