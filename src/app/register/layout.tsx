import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Mumineen Registration · Ashara Mubaraka 1448H — Chicago Relay Center",
  description: "Register your family's travel and accommodation details for Ashara Mubaraka 1448H at the Chicago Relay Center.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Google tag (gtag.js) — scoped to the registration page */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-8H1W6D5XFQ"
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          gtag('config', 'G-8H1W6D5XFQ');
        `}
      </Script>
      {children}
    </>
  );
}
