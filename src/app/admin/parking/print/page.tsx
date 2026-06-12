"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { canViewParking } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Pass = { id: string; hof_its: string; head_name: string; phone: string | null; lot_name: string; lot_color: string | null };
type Lot = { id: string; name: string; color: string | null };

const ENTRY_ZONES: Record<string, { label: string; direction: string; textColor: string; bannerBg: string; bannerText: string; bannerBorder?: string }> = {
  red:   { label: "RED",   direction: "Enter from Hillside Ln.",         textColor: "#cc0000", bannerBg: "#dc2626", bannerText: "#fff" },
  blue:  { label: "BLUE",  direction: "Enter from 91st St.",             textColor: "#1d4ed8", bannerBg: "#2563eb", bannerText: "#fff" },
  white: { label: "WHITE", direction: "Enter from Kingery Hwy (Rt. 83)", textColor: "#374151", bannerBg: "#d1d5db", bannerText: "#111", bannerBorder: "2px solid #9ca3af" },
  gold:  { label: "GOLD",  direction: "Enter from Kingery Hwy (Rt. 83)", textColor: "#92400e", bannerBg: "#d4a017", bannerText: "#111" },
};

function zoneInfo(color: string | null) {
  const key = (color ?? "").toLowerCase();
  return ENTRY_ZONES[key] ?? { label: (color ?? "").toUpperCase(), direction: "", textColor: "#374151", bannerBg: "#6b7280", bannerText: "#fff" };
}

function PassCard({ pass }: { pass: Pass }) {
  const zone = zoneInfo(pass.lot_color);
  return (
    <div
      style={{
        border: "2px solid #222",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#fff",
        color: "#111",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
      }}
    >
      {/* ── COLOR BANNER ── */}
      <div
        style={{
          background: zone.bannerBg,
          borderBottom: zone.bannerBorder ?? "none",
          padding: "14px 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ color: zone.bannerText, fontSize: "36px", fontWeight: "900", letterSpacing: "0.06em", lineHeight: 1 }}>
            {zone.label}
          </div>
          <div style={{ color: zone.bannerText, fontSize: "11px", fontWeight: "bold", letterSpacing: "0.16em", marginTop: "5px", opacity: 0.85 }}>
            PARKING PASS
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: zone.bannerText, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.05em", lineHeight: 1.45, opacity: 0.9 }}>
            ASHARA MUBARAKA 1448H
          </div>
          <div style={{ color: zone.bannerText, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.05em", lineHeight: 1.45, opacity: 0.9 }}>
            CHICAGO RELAY CENTER
          </div>
        </div>
      </div>

      {/* ── LOGO (expands to fill available height) ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 20px",
          minHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.jpg"
          alt="Ashara Mubaraka 1448H — Chicago Relay Center"
          style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>

      {/* ── DATA TABLE ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", color: "#111", flexShrink: 0 }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #888", padding: "7px 10px", background: "#e8e8e8", fontWeight: "bold", whiteSpace: "nowrap", width: "38%", color: "#111" }}>
              Name:
            </td>
            <td style={{ border: "1px solid #888", padding: "7px 10px", fontWeight: "600", fontSize: "13px", color: "#111" }}>
              {pass.head_name}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #888", padding: "7px 10px", background: "#e8e8e8", fontWeight: "bold", whiteSpace: "nowrap", color: "#111" }}>
              ITS #:
            </td>
            <td style={{ border: "1px solid #888", padding: "7px 10px", color: "#111" }}>
              {pass.hof_its}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #888", padding: "7px 10px", background: "#e8e8e8", fontWeight: "bold", whiteSpace: "nowrap", color: "#111" }}>
              Phone / Contact:
            </td>
            <td style={{ border: "1px solid #888", padding: "7px 10px", color: "#111" }}>
              {pass.phone ?? "—"}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #888", padding: "7px 10px", background: "#e8e8e8", color: "#111" }}>
              <span style={{ fontWeight: "bold" }}>Entry Zone </span>
              <span style={{ fontWeight: "bold", color: zone.textColor }}>{zone.label}</span>
            </td>
            <td style={{ border: "1px solid #888", padding: "7px 10px", color: "#111" }}>
              {zone.direction}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── FOOTER ── */}
      <div
        style={{
          textAlign: "center",
          fontSize: "10px",
          color: "#555",
          fontStyle: "italic",
          padding: "7px 12px 8px",
          letterSpacing: "0.04em",
          flexShrink: 0,
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
          body, html { margin: 0; padding: 0; background: white !important; }
          .print-content { padding: 0 !important; margin: 0 !important; }
          .pass-page {
            width: 11in;
            height: 8.5in;
            box-sizing: border-box;
            padding: 0.3in !important;
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
            display: flex !important;
            flex-direction: row !important;
            gap: 0.25in !important;
          }
          .pass-page:last-child { break-after: avoid; page-break-after: avoid; }
          .pass-slot { flex: 1; display: flex; min-height: 0; }
        }
        @media screen {
          body { background: #e5e7eb; }
          .pass-page {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            margin-bottom: 32px;
            border-radius: 4px;
            min-height: 720px;
          }
          .pass-slot { flex: 1; display: flex; min-height: 0; }
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
          <span style={{ fontWeight: "700", fontSize: "15px", color: "#111" }}>
            {lot ? `${lot.name} — Parking Passes` : "All Parking Passes (by ITS)"}
          </span>
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
        <div style={{ padding: "24px 32px", maxWidth: "1100px", margin: "0 auto" }} className="print-content">
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="pass-page"
              style={{
                display: "flex",
                flexDirection: "row",
                gap: "20px",
                alignItems: "stretch",
              }}
            >
              <div className="pass-slot">
                <PassCard pass={pair[0]} />
              </div>
              <div className="pass-slot">
                {pair[1] ? (
                  <PassCard pass={pair[1]} />
                ) : (
                  <div style={{ border: "2px dashed #e5e7eb", borderRadius: "4px", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
