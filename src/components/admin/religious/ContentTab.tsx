"use client";

import AsharaContent from "./AsharaContent";
import SupplementaryContent from "./SupplementaryContent";

// The Content tab: all religious content management in one place.
//  Zone A — the Ashara majlis content grid (where the active year, e.g. 1448, is ingested).
//  Zone B — supplementary free-form documents + standalone Waaz FAQ blocks.
export default function ContentTab() {
  return (
    <div className="space-y-6">
      <AsharaContent />
      <SupplementaryContent />
    </div>
  );
}
