"use client";

import { useEffect } from "react";

// Old per-webinar links now redirect to the unified /webinars page.
export default function WebinarSeqRedirect() {
  useEffect(() => {
    window.location.replace("/webinars");
  }, []);
  return null;
}
