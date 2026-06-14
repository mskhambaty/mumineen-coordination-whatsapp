"use client";

import AsharaContent from "./AsharaContent";

// The Content tab: religious content management. Zone A — the Ashara majlis content grid (where the
// active year, e.g. 1448, is ingested). Zone B — supplementary free-form docs + standalone Waaz FAQ
// blocks — still lives on /admin/knowledge → "Waaz Talaqi" for now and moves here in a follow-up.
export default function ContentTab() {
  return (
    <div className="space-y-5">
      <AsharaContent />
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Supplementary free-form documents and standalone Waaz FAQ blocks are still on the Knowledge Base
        (“Waaz Talaqi” tab) and will move here in a follow-up.
      </p>
    </div>
  );
}
