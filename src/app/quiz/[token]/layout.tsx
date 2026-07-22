import type { Metadata } from "next";

// Gives the shared quiz link its own social/WhatsApp preview (title + subtitle + logo), instead of
// inheriting the site-wide root metadata. The page itself is a client component, so the OG tags must
// come from this server layout. Scoped to /quiz/* only — the root "/" redirect is unaffected.

const TITLE = "Ashara Mubarakah 1448H Quiz";
const DESCRIPTION = "Test your knowledge from this year's waaz — tap to begin.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://www.chicagorelaycenter.com"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, images: ["/logo.jpg"] },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION, images: ["/logo.jpg"] },
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
