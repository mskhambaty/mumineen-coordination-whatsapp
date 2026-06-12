"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { canViewParking } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Pass = { id: string; hof_its: string; head_name: string; phone: string | null; lot_name: string; lot_color: string | null };
type Lot = { id: string; name: string; color: string | null };

// How many passes to print per lot color (assigned + blank write-in templates).
const LOT_PRINT_TARGETS: Record<string, number> = {
  red: 500, white: 500, blue: 500, gold: 125, silver: 200,
};

const ENTRY_ZONES: Record<string, { label: string; direction: string; textColor: string; bannerBg: string; bannerText: string; bannerBorder?: string }> = {
  red:    { label: "RED",    direction: "Enter from Hillside Ln.",                          textColor: "#111", bannerBg: "#fff", bannerText: "#111", bannerBorder: "2px solid #222" },
  blue:   { label: "BLUE",   direction: "Enter from 91st St.",                              textColor: "#111", bannerBg: "#fff", bannerText: "#111", bannerBorder: "2px solid #222" },
  white:  { label: "WHITE",  direction: "Enter from Kingery Hwy (Rt. 83)",                 textColor: "#111", bannerBg: "#fff", bannerText: "#111", bannerBorder: "2px solid #222" },
  gold:   { label: "GOLD",   direction: "Enter from Kingery Hwy (Rt. 83)",                 textColor: "#111", bannerBg: "#fff", bannerText: "#111", bannerBorder: "2px solid #222" },
  silver: { label: "SILVER", direction: "Anne Jeans School or Burr Ridge Middle School",   textColor: "#111", bannerBg: "#fff", bannerText: "#111", bannerBorder: "2px solid #222" },
};

function zoneInfo(color: string | null) {
  const key = (color ?? "").toLowerCase();
  return ENTRY_ZONES[key] ?? { label: (color ?? "").toUpperCase(), direction: "", textColor: "#374151", bannerBg: "#fff", bannerText: "#111", bannerBorder: "2px solid #222" };
}

const CARD_OUTER: React.CSSProperties = {
  border: "2px solid #222",
  fontFamily: "Arial, Helvetica, sans-serif",
  background: "#fff",
  color: "#111",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  flex: 1,
  overflow: "hidden",
};

function CardBanner({ color }: { color: string | null }) {
  const zone = zoneInfo(color);
  return (
    <div style={{ background: zone.bannerBg, borderBottom: zone.bannerBorder ?? "none", padding: "14px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
      <div>
        <div style={{ color: zone.bannerText, fontSize: "36px", fontWeight: "900", letterSpacing: "0.06em", lineHeight: 1 }}>{zone.label}</div>
        <div style={{ color: zone.bannerText, fontSize: "11px", fontWeight: "bold", letterSpacing: "0.16em", marginTop: "5px", opacity: 0.85 }}>PARKING PASS</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: zone.bannerText, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.05em", lineHeight: 1.45, opacity: 0.9 }}>ASHARA MUBARAKA 1448H</div>
        <div style={{ color: zone.bannerText, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.05em", lineHeight: 1.45, opacity: 0.9 }}>CHICAGO RELAY CENTER</div>
      </div>
    </div>
  );
}

function CardLogo() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 20px", minHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.jpg"
        alt="Ashara Mubaraka 1448H — Chicago Relay Center"
        style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}

const TD_LABEL: React.CSSProperties = { border: "1px solid #888", padding: "7px 10px", background: "#e8e8e8", fontWeight: "bold", whiteSpace: "nowrap", width: "38%", color: "#111" };
const TD_VALUE: React.CSSProperties = { border: "1px solid #888", padding: "7px 10px", color: "#111" };
const WRITE_LINE: React.CSSProperties = { borderBottom: "1px solid #999", display: "inline-block", width: "100%", minHeight: "18px" };

function PassCard({ pass }: { pass: Pass }) {
  const zone = zoneInfo(pass.lot_color);
  return (
    <div style={CARD_OUTER}>
      <CardBanner color={pass.lot_color} />
      <CardLogo />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", color: "#111", flexShrink: 0 }}>
        <tbody>
          <tr>
            <td style={TD_LABEL}>Name:</td>
            <td style={{ ...TD_VALUE, fontWeight: 600, fontSize: "13px" }}>{pass.head_name}</td>
          </tr>
          <tr>
            <td style={TD_LABEL}>ITS #:</td>
            <td style={TD_VALUE}>{pass.hof_its}</td>
          </tr>
          <tr>
            <td style={TD_LABEL}>Phone / Contact:</td>
            <td style={TD_VALUE}>{pass.phone ?? "—"}</td>
          </tr>
          <tr>
            <td style={{ ...TD_LABEL, fontWeight: "normal" }}>
              <span style={{ fontWeight: "bold" }}>Entry Zone </span>
              <span style={{ fontWeight: "bold" }}>{zone.label}</span>
            </td>
            <td style={TD_VALUE}>{zone.direction}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ textAlign: "center", fontSize: "10px", color: "#555", fontStyle: "italic", padding: "7px 12px 8px", letterSpacing: "0.04em", flexShrink: 0 }}>
        Please display clearly on the dashboard.
      </div>
    </div>
  );
}

function BlankPassCard({ lotColor }: { lotColor: string | null }) {
  const zone = zoneInfo(lotColor);
  return (
    <div style={CARD_OUTER}>
      <CardBanner color={lotColor} />
      <CardLogo />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", color: "#111", flexShrink: 0 }}>
        <tbody>
          <tr>
            <td style={TD_LABEL}>Name:</td>
            <td style={TD_VALUE}><span style={WRITE_LINE} /></td>
          </tr>
          <tr>
            <td style={TD_LABEL}>ITS #:</td>
            <td style={TD_VALUE}><span style={WRITE_LINE} /></td>
          </tr>
          <tr>
            <td style={TD_LABEL}>Phone / Contact:</td>
            <td style={TD_VALUE}><span style={WRITE_LINE} /></td>
          </tr>
          <tr>
            <td style={{ ...TD_LABEL, fontWeight: "normal" }}>
              <span style={{ fontWeight: "bold" }}>Entry Zone </span>
              <span style={{ fontWeight: "bold" }}>{zone.label}</span>
            </td>
            <td style={TD_VALUE}>{zone.direction}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ textAlign: "center", fontSize: "10px", color: "#555", fontStyle: "italic", padding: "7px 12px 8px", letterSpacing: "0.04em", flexShrink: 0 }}>
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

  // Pad to the lot's print target so the remainder are blank write-in templates.
  const lotColor = lot?.color?.toLowerCase() ?? null;
  const target = lotColor ? (LOT_PRINT_TARGETS[lotColor] ?? null) : null;
  const paddedPasses: (Pass | null)[] = [...passes];
  if (target !== null && paddedPasses.length < target) {
    const needed = target - paddedPasses.length;
    for (let i = 0; i < needed; i++) paddedPasses.push(null);
  }

  const pairs: [Pass | null, Pass | null][] = [];
  for (let i = 0; i < paddedPasses.length; i += 2) {
    pairs.push([paddedPasses[i] ?? null, paddedPasses[i + 1] ?? null]);
  }

  const blankCount = paddedPasses.filter((p) => p === null).length;

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

  const slotFor = (p: Pass | null) =>
    p ? <PassCard pass={p} /> : <BlankPassCard lotColor={lotColor} />;

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
        style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "10px 20px", background: "#fff", borderBottom: "1px solid #e5e7eb", fontFamily: "Arial, sans-serif" }}
      >
        <div>
          <span style={{ fontWeight: "700", fontSize: "15px", color: "#111" }}>
            {lot ? `${lot.name} — Parking Passes` : "All Parking Passes (by ITS)"}
          </span>
          <span style={{ marginLeft: "10px", fontSize: "13px", color: "#6b7280" }}>
            {passes.length} assigned · {blankCount} blank · {pairs.length} page{pairs.length === 1 ? "" : "s"}
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

      {paddedPasses.length === 0 ? (
        <div style={{ display: "flex", height: "40vh", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif", color: "#9ca3af", fontSize: "14px" }}>
          No passes found.
        </div>
      ) : (
        <div style={{ padding: "24px 32px", maxWidth: "1100px", margin: "0 auto" }} className="print-content">
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="pass-page"
              style={{ display: "flex", flexDirection: "row", gap: "20px", alignItems: "stretch" }}
            >
              <div className="pass-slot">{slotFor(pair[0])}</div>
              <div className="pass-slot">{slotFor(pair[1])}</div>
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
