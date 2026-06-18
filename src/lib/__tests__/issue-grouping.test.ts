import { describe, expect, it } from "vitest";

import { selectPromotableClusters, type RawCluster } from "@/lib/escalation/issue-grouping";

const valid = new Set(["s1", "s2", "s3", "s4"]);

describe("selectPromotableClusters (Trigger B safety gate)", () => {
  it("promotes a high-confidence cluster of >=2 distinct conversations", () => {
    const clusters: RawCluster[] = [{ title: "AC out in hall", confidence: "high", sessionIds: ["s1", "s2"] }];
    expect(selectPromotableClusters(clusters, valid)).toEqual([{ title: "AC out in hall", sessionIds: ["s1", "s2"] }]);
  });

  it("drops clusters that are not high confidence", () => {
    const clusters: RawCluster[] = [
      { title: "maybe related", confidence: "medium", sessionIds: ["s1", "s2"] },
      { title: "loose", confidence: "low", sessionIds: ["s3", "s4"] },
      { title: "no confidence given", sessionIds: ["s1", "s2"] },
    ];
    expect(selectPromotableClusters(clusters, valid)).toEqual([]);
  });

  it("never promotes a lone escalation (a single conversation is not an issue)", () => {
    const clusters: RawCluster[] = [{ title: "solo", confidence: "high", sessionIds: ["s1"] }];
    expect(selectPromotableClusters(clusters, valid)).toEqual([]);
  });

  it("dedupes repeated session ids within a cluster (and drops it if <2 remain)", () => {
    const clusters: RawCluster[] = [{ title: "dup", confidence: "high", sessionIds: ["s1", "s1"] }];
    expect(selectPromotableClusters(clusters, valid)).toEqual([]);
  });

  it("ignores unknown/stale session ids the model invented", () => {
    const clusters: RawCluster[] = [{ title: "with ghost", confidence: "high", sessionIds: ["s1", "s2", "ghost"] }];
    expect(selectPromotableClusters(clusters, valid)).toEqual([{ title: "with ghost", sessionIds: ["s1", "s2"] }]);
  });

  it("assigns each conversation to at most one cluster (no double-linking)", () => {
    const clusters: RawCluster[] = [
      { title: "first", confidence: "high", sessionIds: ["s1", "s2"] },
      { title: "overlap", confidence: "high", sessionIds: ["s2", "s3"] }, // s2 already used → only s3 left → <2 → dropped
    ];
    expect(selectPromotableClusters(clusters, valid)).toEqual([{ title: "first", sessionIds: ["s1", "s2"] }]);
  });

  it("falls back to a default title when the model gives none", () => {
    const clusters: RawCluster[] = [{ title: "", confidence: "high", sessionIds: ["s3", "s4"] }];
    expect(selectPromotableClusters(clusters, valid)).toEqual([{ title: "Grouped issue", sessionIds: ["s3", "s4"] }]);
  });
});
