import { optionalEnv, requireEnv } from "@/lib/env";

// A WhatsApp "account" is one phone number under one WhatsApp Business Account (WABA), bundled
// with the credentials needed to operate it: send/receive (phoneNumberId + accessToken), fetch
// its message templates (wabaId), and verify its inbound webhooks (appSecret for the POST
// signature, verifyToken for the GET handshake). Each account belongs to its own Meta App.
//
// The registry lets the app serve more than one WhatsApp number — e.g. a higher-tier broadcast
// number — while keeping the original single-number deployment unchanged: when the broadcast
// (*_BROADCAST) env vars are absent, only the primary account exists and behavior is identical.
export type WhatsAppAccount = {
  // Human-readable handle ("primary" | "broadcast"); safe to log (not PII, not a secret).
  label: string;
  // Required to send and to match inbound webhooks. Drives the /{phoneNumberId}/messages endpoint.
  phoneNumberId: string;
  // SECRET. Bearer token for this account's Meta Graph API calls.
  accessToken: string;
  // WhatsApp Business Account id. Required only to list/resolve this account's templates.
  wabaId?: string;
  // SECRET. App secret of the Meta App that owns this account; validates inbound POST signatures.
  appSecret?: string;
  // SECRET. Token echoed during the Meta webhook GET handshake for this account's callback URL.
  verifyToken?: string;
  // Display phone number (e.g. +1630…) — optional, used for labeling / inbound allow-checks.
  displayNumber?: string;
};

export const PRIMARY_LABEL = "primary";
export const BROADCAST_LABEL = "broadcast";

// The primary account is the original single-number configuration (unsuffixed env vars).
// phoneNumberId + accessToken are required — a send is impossible without them — and throw the
// same "missing env" error as before, lazily, only when an account is actually resolved.
export function getPrimaryAccount(): WhatsAppAccount {
  return {
    label: PRIMARY_LABEL,
    phoneNumberId: requireEnv("WHATSAPP_PHONE_NUMBER_ID"),
    accessToken: requireEnv("WHATSAPP_ACCESS_TOKEN"),
    wabaId: optionalEnv("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    appSecret: optionalEnv("META_APP_SECRET"),
    verifyToken: optionalEnv("META_WEBHOOK_VERIFY_TOKEN"),
    displayNumber: optionalEnv("WHATSAPP_DISPLAY_PHONE_NUMBER"),
  };
}

// The broadcast account is the optional second number (suffixed *_BROADCAST env vars). Returns
// null when not configured, so existing single-number deployments resolve only the primary.
// Presence is keyed on the phone number id; if that's set, the access token is required too.
export function getBroadcastAccount(): WhatsAppAccount | null {
  if (!optionalEnv("WHATSAPP_PHONE_NUMBER_ID_BROADCAST")) {
    return null;
  }
  return {
    label: BROADCAST_LABEL,
    phoneNumberId: requireEnv("WHATSAPP_PHONE_NUMBER_ID_BROADCAST"),
    accessToken: requireEnv("WHATSAPP_ACCESS_TOKEN_BROADCAST"),
    wabaId: optionalEnv("WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST"),
    appSecret: optionalEnv("META_APP_SECRET_BROADCAST"),
    verifyToken: optionalEnv("META_WEBHOOK_VERIFY_TOKEN_BROADCAST"),
    displayNumber: optionalEnv("WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST"),
  };
}

// All configured accounts, primary first.
export function getAccounts(): WhatsAppAccount[] {
  const broadcast = getBroadcastAccount();
  return broadcast ? [getPrimaryAccount(), broadcast] : [getPrimaryAccount()];
}

export function getAccountByLabel(label: string): WhatsAppAccount | undefined {
  return getAccounts().find((account) => account.label === label);
}

// Resolve the account a message arrived on, from the webhook's metadata.phone_number_id.
export function getAccountByPhoneNumberId(phoneNumberId: string): WhatsAppAccount | undefined {
  return getAccounts().find((account) => account.phoneNumberId === phoneNumberId);
}

// Resolve the account that owns a template, from the template's WABA id. A template lives in
// exactly one WABA, so this determines which number (and credentials) sends it.
export function getAccountByWaba(wabaId: string): WhatsAppAccount | undefined {
  return getAccounts().find((account) => account.wabaId === wabaId);
}
