"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { canViewParking } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Pass = { id: string; head_name: string; phone: string | null };
type Lot = { id: string; name: string; color: string | null };

const ENTRY_ZONES: Record<string, { label: string; direction: string; textColor: string }> = {
  red:   { label: "RED",   direction: "Enter from Hillside Ln.",         textColor: "#cc0000" },
  blue:  { label: "BLUE",  direction: "Enter from 91st St.",             textColor: "#1d4ed8" },
  white: { label: "WHITE", direction: "Enter from Kingery Hwy (Rt. 83)", textColor: "#374151" },
  gold:  { label: "GOLD",  direction: "Enter from Kingery Hwy (Rt. 83)", textColor: "#92400e" },
};

function zoneInfo(color: string | null) {
  const key = (color ?? "").toLowerCase();
  return (
    ENTRY_ZONES[key] ?? {
      label: (color ?? "").toUpperCase(),
      direction: "",
      textColor: "#374151",
    }
  );
}

function PassCard({ pass, lot }: { pass: Pass; lot: Lot }) {
  const zone = zoneInfo(lot.color);
  return (
    <div
      style={{
        border: "2px solid #222",
        padding: "14px 18px",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.08em", color: "#111", lineHeight: 1.3 }}>
            ASHARA MUBARAKA 1448H &nbsp;/&nbsp; CHICAGO RELAY CENTER
          </div>
          <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "0.12em", color: "#111", marginTop: "2px" }}>
            PARKING ENTRY
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.jpg"
          alt="Ashara Mubaraka 1448H — Chicago Relay Center"
          style={{ height: "72px", width: "auto", objectFit: "contain", marginLeft: "16px", flexShrink: 0 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>

      {/* Name / Phone row */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginBottom: "10px",
          fontSize: "13px",
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                background: "#f0f0f0",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                width: "1%",
              }}
            >
              Name:
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 12px",
                fontWeight: "600",
                fontSize: "14px",
              }}
            >
              {pass.head_name}
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 10px",
                background: "#f0f0f0",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                width: "1%",
              }}
            >
              Phone / Contact:
            </td>
            <td
              style={{
                border: "1px solid #888",
                padding: "7px 12px",
                width: "22%",
              }}
            >
              {pass.phone ?? "—"}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Entry zone */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          border: "1px solid #888",
          padding: "8px 12px",
          marginBottom: "8px",
          fontSize: "14px",
        }}
      >
        <span style={{ fontWeight: "bold" }}>Entry Zone</span>
        <span style={{ color: zone.textColor, fontWeight: "bold", fontSize: "16px", letterSpacing: "0.06em" }}>
          {zone.label}
        </span>
        {zone.direction && (
          <>
            <span style={{ color: "#aaa", fontSize: "16px", fontWeight: "300" }}>|</span>
            <span style={{ color: "#333" }}>{zone.direction}</span>
          </>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          fontSize: "11px",
          color: "#555",
          fontStyle: "italic",
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
    if (!lotId) {
      setError("No lot selected. Close this tab and click a lot's Print button.");
      setLoading(false);
      return;
    }
    const res = await apiFetch(`/api/admin/parking/print?lot_id=${encodeURIComponent(lotId)}`);
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

  // Pair passes for 2-per-page layout.
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
          @page { size: letter portrait; margin: 0.45in; }
          body { background: white !important; }
          .pass-page { page-break-after: always; page-break-inside: avoid; }
          .pass-page:last-child { page-break-after: avoid; }
        }
        @media screen {
          body { background: #e5e7eb; }
          .pass-page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.12); margin-bottom: 32px; }
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
          <span style={{ fontWeight: "700", fontSize: "15px", color: "#111" }}>{lot?.name ?? "Lot"} — Parking Passes</span>
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
          No passes are assigned to this lot yet.
        </div>
      ) : (
        <div style={{ padding: "24px 32px", maxWidth: "780px", margin: "0 auto" }}>
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="pass-page"
              style={{ padding: "20px" }}
            >
              {lot && <PassCard pass={pair[0]} lot={lot} />}

              {/* Mid-page separator / second pass */}
              <div style={{ margin: "18px 0", borderTop: "2px dashed #ccc" }} />

              {pair[1] && lot ? (
                <PassCard pass={pair[1]} lot={lot} />
              ) : (
                // Empty placeholder so the page is the right height even for odd pass counts.
                <div style={{ height: "170px", border: "2px dashed #e5e7eb", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#d1d5db", fontSize: "12px", fontFamily: "Arial, sans-serif" }}>— blank —</span>
                </div>
              )}
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
