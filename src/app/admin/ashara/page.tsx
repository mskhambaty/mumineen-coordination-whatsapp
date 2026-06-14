"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Ashara daily-content grid moved into the Waaz Talaqqi hub (Content tab). Redirect any old
// bookmarks/links there.
export default function AsharaRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/religious?tab=content");
  }, [router]);
  return null;
}
