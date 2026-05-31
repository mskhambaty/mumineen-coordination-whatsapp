import { describe, expect, it } from "vitest";

import { scraperInternals } from "@/lib/scraper/scrape-site";

describe("scraper internals", () => {
  it("parses quoted Google Sheet CSV rows", () => {
    const rows = scraperInternals.parseCsv('Name,Notes,Phone\n"Hotel A","Line 1\nLine 2",630-000-0000\n');

    expect(rows).toEqual([
      ["Name", "Notes", "Phone"],
      ["Hotel A", "Line 1\nLine 2", "630-000-0000"],
    ]);
  });

  it("turns hotel sheet rows into searchable chunks", () => {
    const chunks = scraperInternals.hotelRowsToChunks([
      ["Name", "Address", "City", "zip", "Miles from masjid", "Phone Number", "Breakfast included (Y/N)?", "Block rate ", "Code", "Link"],
      ["Holiday Inn", "205 Remington Blvd", "Bolingbrook", "60440", "7.2", "630-679-1600", "Y", "$129", "Ashara", "https://example.com/book"],
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].page_title).toBe("Ashara Relay Hotel Information Sheet");
    expect(chunks[0].content).toContain("Hotel: Holiday Inn");
    expect(chunks[0].content).toContain("Breakfast included: Y");
    expect(chunks[0].content).toContain("Booking code: Ashara");
  });
});
