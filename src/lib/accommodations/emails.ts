import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireEnv, optionalEnv } from "@/lib/env";

const POSTMARK_API = "https://api.postmarkapp.com";
const HELPLINE_WHATSAPP = "+1 (630) 819-0250";
const HELPLINE_LINK = "https://wa.me/16308190250";

async function sendRawEmail(to: string, subject: string, htmlBody: string, textBody: string): Promise<void> {
  const res = await fetch(`${POSTMARK_API}/email`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": requireEnv("POSTMARK_API_TOKEN"),
    },
    body: JSON.stringify({
      MessageStream: "outbound",
      From: requireEnv("POSTMARK_FROM_EMAIL"),
      To: to,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Postmark error ${res.status}: ${errorBody}`);
  }
}

export type ConfirmationEmailResult = {
  guestEmailSent: boolean;
  hostEmailSent: boolean;
  guestEmail?: string;
  hostEmail?: string;
  errors: string[];
};

/**
 * Look up a mumin's email by ITS from the mumineen table.
 */
export async function lookupEmailByIts(its: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("mumineen")
    .select("email")
    .eq("its", its)
    .not("email", "is", null)
    .limit(1)
    .single();
  return data?.email ?? null;
}

/**
 * Send confirmation emails to both guest and host after a match is confirmed.
 */
export async function sendAccommodationConfirmationEmails(matchId: string): Promise<ConfirmationEmailResult> {
  const supabase = getSupabaseAdmin();
  const result: ConfirmationEmailResult = { guestEmailSent: false, hostEmailSent: false, errors: [] };

  // Load match with host details
  const { data: match, error: matchErr } = await supabase
    .from("accommodation_matches")
    .select("id, guest_family_id, host_id, status, guest_member_count")
    .eq("id", matchId)
    .single();

  if (matchErr || !match) {
    result.errors.push("Match not found");
    return result;
  }

  // Load host
  const { data: host } = await supabase
    .from("accommodation_hosts")
    .select("hof_its, first_name, last_name, address, city, mobile")
    .eq("id", match.host_id)
    .single();

  if (!host) {
    result.errors.push("Host not found");
    return result;
  }

  // Load guest family HOF
  const { data: family } = await supabase
    .from("families")
    .select("hof_its")
    .eq("id", match.guest_family_id)
    .single();

  if (!family) {
    result.errors.push("Guest family not found");
    return result;
  }

  // Look up guest HOF info from mumineen
  const { data: guestMumin } = await supabase
    .from("mumineen")
    .select("full_name, email, whatsapp_e164")
    .eq("its", family.hof_its)
    .limit(1)
    .single();

  // Look up host email from mumineen
  const hostEmail = await lookupEmailByIts(host.hof_its);
  const guestEmail = guestMumin?.email ?? null;

  const hostName = [host.first_name, host.last_name].filter(Boolean).join(" ") || host.hof_its;
  const hostContact = host.mobile ?? "—";
  const hostAddress = [host.address, host.city].filter(Boolean).join(", ") || "—";
  const guestName = guestMumin?.full_name ?? family.hof_its;
  const guestContact = guestMumin?.whatsapp_e164 ?? "—";
  const checklistUrl = optionalEnv("ACCOMMODATION_HOST_CHECKLIST_URL") ?? "";

  // Send guest email
  if (guestEmail) {
    try {
      const subject = "Ashara Mubaraka 1448H — Your Accommodation Details";
      const html = buildGuestEmailHtml(guestName, hostName, hostContact, hostAddress);
      const text = buildGuestEmailText(guestName, hostName, hostContact, hostAddress);
      await sendRawEmail(guestEmail, subject, html, text);
      result.guestEmailSent = true;
      result.guestEmail = guestEmail;
    } catch (e) {
      result.errors.push(`Guest email failed: ${(e as Error).message}`);
    }
  } else {
    result.errors.push("Guest has no email on file");
  }

  // Send host email
  if (hostEmail) {
    try {
      const subject = "Ashara Mubaraka 1448H — Your Mehman Assignment";
      const html = buildHostEmailHtml(hostName, guestName, guestContact, match.guest_member_count, checklistUrl);
      const text = buildHostEmailText(hostName, guestName, guestContact, match.guest_member_count, checklistUrl);
      await sendRawEmail(hostEmail, subject, html, text);
      result.hostEmailSent = true;
      result.hostEmail = hostEmail;
    } catch (e) {
      result.errors.push(`Host email failed: ${(e as Error).message}`);
    }
  } else {
    result.errors.push("Host has no email on file (not found in mumineen table)");
  }

  return result;
}

// ─── HTML Templates ────────────────────────────────────────────────────────────

function buildGuestEmailHtml(guestName: string, hostName: string, hostContact: string, hostAddress: string): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #0a3d2e;">Ashara Mubaraka Relay 1448H</h2>

  <p>Salaamun Alaikum ${escHtml(guestName)},</p>

  <p>Khuda Ta'ala nu shukur karye che ke aa saal hamne Aqa Moula TUS na Asharah Mubarakah 1448H ni waaz nu relay naseeb thayu. Aap sagla nu Shukriyah, aap sagla ye Chicago relay center select karine hamne Khidmat no mauqe aapu.</p>

  <p>Based on your accommodation request, arrangements have been made for you to stay at a mumin family's home. We are grateful to the host family for opening their home in the spirit of ikram al-mumin and khidmat during these mubarak days.</p>

  <p><strong>Please find your host information below:</strong></p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr style="background: #f5f5f5;">
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Name</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd;">${escHtml(hostName)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Contact</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd;">${escHtml(hostContact)}</td>
    </tr>
    <tr style="background: #f5f5f5;">
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Address</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd;">${escHtml(hostAddress)}</td>
    </tr>
  </table>

  <p>We encourage you to contact your host prior to your arrival to coordinate travel details.</p>

  <p><em>Chicago mumineen may be going to London immediately after Ashura for shukr araz.</em></p>

  <p>To help ensure a smooth experience for all participants, mumineen are kindly encouraged to make their own transportation arrangements to and from waaz, relay venues, and other destinations during their stay. If you anticipate any challenges, please feel free to communicate with your host in advance.</p>

  <p>If you have any questions or require assistance, please contact the Accommodation Team via WhatsApp at <a href="${HELPLINE_LINK}">${HELPLINE_WHATSAPP}</a>.</p>

  <p>We look forward to welcoming you to Chicago and pray that Allah Ta'ala grants you a memorable and spiritually rewarding Ashara Mubaraka.</p>

  <p>Shukron.<br/>
  <strong>Chicago Jamaat Accommodation Team</strong><br/>
  Ashara Mubaraka Relay 1448H</p>
</div>
`.trim();
}

function buildGuestEmailText(guestName: string, hostName: string, hostContact: string, hostAddress: string): string {
  return [
    `Salaamun Alaikum ${guestName},`,
    ``,
    `Khuda Ta'ala nu shukur karye che ke aa saal hamne Aqa Moula TUS na Asharah Mubarakah 1448H ni waaz nu relay naseeb thayu. Aap sagla nu Shukriyah, aap sagla ye Chicago relay center select karine hamne Khidmat no mauqe aapu.`,
    ``,
    `Based on your accommodation request, arrangements have been made for you to stay at a mumin family's home. We are grateful to the host family for opening their home in the spirit of ikram al-mumin and khidmat during these mubarak days.`,
    ``,
    `Your host information:`,
    `  Name:    ${hostName}`,
    `  Contact: ${hostContact}`,
    `  Address: ${hostAddress}`,
    ``,
    `We encourage you to contact your host prior to your arrival to coordinate travel details.`,
    ``,
    `Chicago mumineen may be going to London immediately after Ashura for shukr araz.`,
    ``,
    `To help ensure a smooth experience, mumineen are kindly encouraged to make their own transportation arrangements to and from waaz, relay venues, and other destinations during their stay. If you anticipate any challenges, please communicate with your host in advance.`,
    ``,
    `If you have any questions, contact the Accommodation Team via WhatsApp at ${HELPLINE_WHATSAPP}.`,
    ``,
    `Shukron.`,
    `Chicago Jamaat Accommodation Team`,
    `Ashara Mubaraka Relay 1448H`,
  ].join("\n");
}

function buildHostEmailHtml(hostName: string, guestName: string, guestContact: string, memberCount: number, checklistUrl: string): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #0a3d2e;">Ashara Mubaraka Relay 1448H</h2>

  <p>Salaamun Alaikum ${escHtml(hostName)},</p>

  <p>Khuda Ta'ala nu shukur karye che ke aa saal hamne Aqa Moula TUS na Asharah Mubarakah 1448H ni waaz nu relay naseeb thayu. Moula TUS ni khushi che ke mehmano ni karamat karye ane apna gharo ma utaro aapye.</p>

  <p>Moula TUS nu farman uthawi ne aap ye aap na ghar ne kholi ne mehmano ne utarva ni niyat kidi che.</p>

  <p>We kindly request that you reach out to your assigned mehman as soon as possible. Please introduce yourself, provide them with the details of their accommodation, and extend your warm welcome and izan. Early communication will help establish expectations and ensure a smooth arrival experience for both hosts and guests.</p>

  <p><strong>Your mehman details:</strong></p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr style="background: #f5f5f5;">
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Name</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd;">${escHtml(guestName)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Contact</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd;">${escHtml(guestContact)}</td>
    </tr>
    <tr style="background: #f5f5f5;">
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Members</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd;">${memberCount}</td>
    </tr>
  </table>

  <p>We also encourage you to discuss travel details and transportation arrangements with your mehman. As communicated to attendees, mehman are expected to arrange their own transportation to and from waaz and other destinations during their stay. However, a brief discussion beforehand can help clarify expectations and avoid any misunderstandings.</p>

  <p>You should also discuss any travel plans after Ashura.</p>

  ${checklistUrl ? `<p><strong>Checklist:</strong> <a href="${escHtml(checklistUrl)}">Ashara Utaro – Host Family Checklist</a></p>` : ""}

  <p>If you have any questions or require assistance at any time, please do not hesitate to contact us via WhatsApp at <a href="${HELPLINE_LINK}">${HELPLINE_WHATSAPP}</a>.</p>

  <p>Wassalaam,<br/>
  <strong>Chicago Jamaat Accommodation Team</strong><br/>
  Ashara Mubaraka Relay 1448H</p>
</div>
`.trim();
}

function buildHostEmailText(hostName: string, guestName: string, guestContact: string, memberCount: number, checklistUrl: string): string {
  return [
    `Salaamun Alaikum ${hostName},`,
    ``,
    `Khuda Ta'ala nu shukur karye che ke aa saal hamne Aqa Moula TUS na Asharah Mubarakah 1448H ni waaz nu relay naseeb thayu. Moula TUS ni khushi che ke mehmano ni karamat karye ane apna gharo ma utaro aapye.`,
    ``,
    `Moula TUS nu farman uthawi ne aap ye aap na ghar ne kholi ne mehmano ne utarva ni niyat kidi che.`,
    ``,
    `We kindly request that you reach out to your assigned mehman as soon as possible. Please introduce yourself, provide them with the details of their accommodation, and extend your warm welcome and izan.`,
    ``,
    `Your mehman details:`,
    `  Name:    ${guestName}`,
    `  Contact: ${guestContact}`,
    `  Members: ${memberCount}`,
    ``,
    `We encourage you to discuss travel details and transportation arrangements with your mehman. Mehman are expected to arrange their own transportation, but a discussion beforehand can help clarify expectations.`,
    ``,
    `You should also discuss any travel plans after Ashura.`,
    ``,
    ...(checklistUrl ? [`Checklist: ${checklistUrl}`, ``] : []),
    `If you have any questions, contact us via WhatsApp at ${HELPLINE_WHATSAPP}.`,
    ``,
    `Wassalaam,`,
    `Chicago Jamaat Accommodation Team`,
    `Ashara Mubaraka Relay 1448H`,
  ].join("\n");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
