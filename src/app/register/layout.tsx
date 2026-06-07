import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mumineen Registration · Ashara Mubaraka 1448H — Chicago Relay Center",
  description: "Register your family's travel and accommodation details for Ashara Mubaraka 1448H at the Chicago Relay Center.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
