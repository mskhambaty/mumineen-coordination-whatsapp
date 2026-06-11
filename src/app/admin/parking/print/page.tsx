"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { canViewParking } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Pass = { id: string; hof_its: string; head_name: string; phone: string | null; lot_name: string; lot_color: string | null };
type Lot = { id: string; name: string; color: string | null };

const ENTRY_ZONES: Record<string, { label: string; direction: string; textColor: string; stampBg: string; stampText: string }> = {
  red:   { label: "RED",   direction: "Enter from Hillside Ln.",         textColor: "#cc0000", stampBg: "#dc2626", stampText: "#fff" },
  blue:  { label: "BLUE",  direction: "Enter from 91st St.",             textColor: "#1d4ed8", stampBg: "#2563eb", stampText: "#fff" },
  white: { label: "WHITE", direction: "Enter from Kingery Hwy (Rt. 83)", textColor: "#374151", stampBg: "#f0f0f0", stampText: "#111" },
  gold:  { label: "GOLD",  direction: "Enter from Kingery Hwy (Rt. 83)", textColor: "#92400e", stampBg: "#d4a017", stampText: "#111" },
};

function zoneInfo(color: string | null) {
  const key = (color ?? "").toLowerCase();
  return ENTRY_ZONES[key] ?? { label: (color ?? "").toUpperCase(), direction: "", textColor: "#374151", stampBg: "#9ca3af", stampText: "#fff" };
}

// Portrait-style pass: title → logo → table → footer (stacked vertically).
function PassCard({ pass }: { pass: Pass }) {
  const zone = zoneInfo(pass.lot_color);
  return (
    <div
      style={{
        border: "2px solid #222",
        padding: "20px 18px 16px",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#fff",
        color: "#111",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        flex: 1,
        position: "relative",
      }}
    >
      {/* Color-coded lot stamp */}
      <div
        style={{
          position: "absolute",
          top: "14px",
          right: "14px",
          width: "68px",
          height: "68px",
          borderRadius: "50%",
          background: zone.stampBg,
          border: zone.label === "WHITE" ? "2px solid #bbb" : "3px solid rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 6px rgba(0,0,0,0.20)",
        }}
      >
        <span style={{ color: zone.stampText, fontWeight: "bold", fontSize: "13px", letterSpacing: "0.04em", lineHeight: 1 }}>
          {zone.label}
        </span>
      </div>

      {/* Centered title */}
      <div style={{ textAlign: "center", marginBottom: "14px" }}>
        <div style={{ fontSize: "15px", fontWeight: "bold", letterSpacing: "0.07em", color: "#111", lineHeight: 1.4 }}>
          ASHARA MUBARAKA 1448H
        </div>
        <div style={{ fontSize: "15px", fontWeight: "bold", letterSpacing: "0.07em", color: "#111", lineHeight: 1.4 }}>
          CHICAGO RELAY CENTER
        </div>
        <div style={{ fontSize: "13px", fontWeight: "bold", letterSpacing: "0.12em", color: "#111", marginTop: "4px" }}>
          PARKING ENTRY
        </div>
      </div>

      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.jpg"
        alt="Ashara Mubaraka 1448H — Chicago Relay Center"
        style={{ height: "180px", width: "auto", objectFit: "contain", marginBottom: "20px" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      {/* Data table: Name | Phone | Entry Zone */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "12px",
          color: "#111",
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                background: "#e8e8e8",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                width: "38%",
                color: "#111",
              }}
            >
              Name:
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                fontWeight: "600",
                fontSize: "13px",
                color: "#111",
              }}
            >
              {pass.head_name}
            </td>
          </tr>
          <tr>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                background: "#e8e8e8",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                color: "#111",
              }}
            >
              ITS #:
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                color: "#111",
              }}
            >
              {pass.hof_its}
            </td>
          </tr>
          <tr>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                background: "#e8e8e8",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                color: "#111",
              }}
            >
              Phone / Contact:
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                color: "#111",
              }}
            >
              {pass.phone ?? "—"}
            </td>
          </tr>
          <tr>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                background: "#e8e8e8",
                color: "#111",
              }}
            >
              <span style={{ fontWeight: "bold" }}>Entry Zone </span>
              <span style={{ fontWeight: "bold", color: zone.textColor }}>{zone.label}</span>
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                color: "#111",
              }}
            >
              {zone.direction}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          fontSize: "10px",
          color: "#555",
          fontStyle: "italic",
          marginTop: "10px",
          letterSpacing: "0.04em",
        }}
      >
        Please display clearly on the dashboard.
      </div>
    </div>
  );
}

function PrintContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lotId = searchParams.get("lot_id");

  const [lot, setLot] = useState<Lot | null>(null);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = lotId
      ? `/api/admin/parking/print?lot_id=${encodeURIComponent(lotId)}`
      : `/api/admin/parking/print`;
    const res = await apiFetch(url);
    const json = (await res.json().catch(() => ({}))) as { lot?: Lot; passes?: Pass[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to load passes.");
      setLoading(false);
      return;
    }
    setLot(json.lot ?? null);
    setPasses(json.passes ?? []);
    setLoading(false);
  }, [lotId]);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) { router.push("/admin/login"); return; }
    if (!canViewParking(user)) { router.push("/admin/conversations"); return; }
    void load();
  }, [router, load]);

  // Group passes into pairs — 2 portrait cards side-by-side per landscape page.
  const pairs: [Pass, Pass | null][] = [];
  for (let i = 0; i < passes.length; i += 2) {
    pairs.push([passes[i], passes[i + 1] ?? null]);
  }

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif", color: "#6b7280" }}>
        Loading passes…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif", color: "#dc2626", padding: "2rem", textAlign: "center" }}>
        {error}
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: letter landscape; margin: 0; }
          body { background: white !important; }
          .print-content { padding: 0 !important; }
          .pass-page {
            height: 100vh;
            box-sizing: border-box;
            padding: 0.35in !important;
            page-break-after: always;
            page-break-inside: avoid;
          }
          .pass-page:last-child { page-break-after: avoid; }
        }
        @media screen {
          body { background: #e5e7eb; }
          .pass-page {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            margin-bottom: 32px;
            border-radius: 4px;
            min-height: 560px;
          }
        }
      `}</style>

      {/* Screen toolbar */}
      <div
        className="no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          padding: "10px 20px",
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div>
          <span style={{ fontWeight: "700", fontSize: "15px", color: "#111" }}>{lot ? `${lot.name} — Parking Passes` : "All Parking Passes (by ITS)"}</span>
          <span style={{ marginLeft: "10px", fontSize: "13px", color: "#6b7280" }}>
            {passes.length} pass{passes.length === 1 ? "" : "es"} · {pairs.length} page{pairs.length === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            onClick={() => window.close()}
            style={{ padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: "6px", background: "#fff", cursor: "pointer", fontSize: "13px", color: "#374151" }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ padding: "6px 16px", border: "none", borderRadius: "6px", background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
          >
            Print
          </button>
        </div>
      </div>

      {passes.length === 0 ? (
        <div style={{ display: "flex", height: "40vh", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif", color: "#9ca3af", fontSize: "14px" }}>
          No passes found.
        </div>
      ) : (
        // Max-width matches landscape letter minus margins (~10in). Screen preview uses the same.
        // Print padding replaces @page margins (which are zeroed to suppress the browser URL footer).
        <div style={{ padding: "24px 32px", maxWidth: "1000px", margin: "0 auto" }} className="print-content">
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="pass-page"
              style={{
                display: "flex",
                flexDirection: "row",
                gap: "24px",
                padding: "20px",
                alignItems: "stretch",
              }}
            >
              <div style={{ flex: 1, display: "flex" }}>
                <PassCard pass={pair[0]} />
              </div>
              <div style={{ flex: 1, display: "flex" }}>
                {pair[1] ? (
                  <PassCard pass={pair[1]} />
                ) : (
                  <div style={{ border: "2px dashed #e5e7eb", borderRadius: "4px", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "#d1d5db", fontSize: "12px", fontFamily: "Arial, sans-serif" }}>— blank —</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function ParkingPrintPage() {
  return (
    <Suspense>
      <PrintContent />
    </Suspense>
  );
}
