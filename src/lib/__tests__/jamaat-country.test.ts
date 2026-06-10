import { describe, expect, it } from "vitest";

import { jamaatCountry } from "@/lib/registration/jamaat-country";

describe("jamaatCountry", () => {
  it("maps known overseas centers from free-text jamaat names", () => {
    expect(jamaatCountry("DUBAI")).toBe("UAE");
    expect(jamaatCountry("SHAREQA")).toBe("UAE");
    expect(jamaatCountry("KUWAIT (MUFADDAL MOHALLA - SALMIYAH)")).toBe("Kuwait");
    expect(jamaatCountry("BURHANI MOHALLA (FAHAHIL-KUWAIT)")).toBe("Kuwait");
    expect(jamaatCountry("KHI (HASANI MOHALLA)")).toBe("Pakistan");
    expect(jamaatCountry("Karachi (Yusufi Mohalla)")).toBe("Pakistan");
    expect(jamaatCountry("HYDERABAD SIND")).toBe("Pakistan");
    expect(jamaatCountry("CAIRO")).toBe("Egypt");
    expect(jamaatCountry("NAIROBI")).toBe("Kenya");
    expect(jamaatCountry("BAHRAIN")).toBe("Bahrain");
    expect(jamaatCountry("SINGAPORE")).toBe("Singapore");
    expect(jamaatCountry("Detroit")).toBe("USA");
  });

  it("defaults Indian cities/mohallas (and unknown tokens) to India", () => {
    expect(jamaatCountry("MAROL")).toBe("India");
    expect(jamaatCountry("HUSAINI ALAM (HYDERABAD)")).toBe("India"); // India Hyderabad, not Sind
    expect(jamaatCountry("HATEMI MOHALLA (MUMBAI)")).toBe("India");
    expect(jamaatCountry("POONA")).toBe("India");
  });

  it("returns null for a blank jamaat (unknown origin)", () => {
    expect(jamaatCountry(null)).toBeNull();
    expect(jamaatCountry("  ")).toBeNull();
  });

  it("does not let the KHI token match unrelated Indian town names", () => {
    expect(jamaatCountry("KHARGHAR")).toBe("India");
    expect(jamaatCountry("KHAMGAON")).toBe("India");
    expect(jamaatCountry("KHERGONE")).toBe("India");
  });
});
