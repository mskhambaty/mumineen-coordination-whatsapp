import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BROADCAST_LABEL,
  PRIMARY_LABEL,
  getAccountByLabel,
  getAccountByPhoneNumberId,
  getAccountByWaba,
  getAccounts,
  getBroadcastAccount,
  getPrimaryAccount,
} from "@/lib/whatsapp/accounts";

// Every env name (canonical + mixed-case alias) the registry reads. Cleared before each test so
// values leaking from the real environment can't influence assertions, then restored after.
const MANAGED_KEYS = [
  "WHATSAPP_PHONE_NUMBER_ID", "Whatsapp_phone_number_id",
  "WHATSAPP_ACCESS_TOKEN", "Whatsapp_access_token",
  "WHATSAPP_BUSINESS_ACCOUNT_ID", "Whatsapp_business_account_id",
  "META_APP_SECRET", "Meta_app_secret",
  "META_WEBHOOK_VERIFY_TOKEN", "Meta_webhook_verify_token",
  "WHATSAPP_DISPLAY_PHONE_NUMBER", "Whatsapp_display_phone_number",
  "WHATSAPP_PHONE_NUMBER_ID_BROADCAST", "Whatsapp_phone_number_id_broadcast",
  "WHATSAPP_ACCESS_TOKEN_BROADCAST", "Whatsapp_access_token_broadcast",
  "WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST", "Whatsapp_business_account_id_broadcast",
  "META_APP_SECRET_BROADCAST", "Meta_app_secret_broadcast",
  "META_WEBHOOK_VERIFY_TOKEN_BROADCAST", "Meta_webhook_verify_token_broadcast",
  "WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST", "Whatsapp_display_phone_number_broadcast",
];

let saved: Record<string, string | undefined>;

function setPrimary() {
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PN_PRIMARY";
  process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN_PRIMARY";
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "WABA_PRIMARY";
  process.env.META_APP_SECRET = "SECRET_PRIMARY";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "VERIFY_PRIMARY";
  process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = "+13120000001";
}

function setBroadcast() {
  process.env.WHATSAPP_PHONE_NUMBER_ID_BROADCAST = "PN_BROADCAST";
  process.env.WHATSAPP_ACCESS_TOKEN_BROADCAST = "TOKEN_BROADCAST";
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST = "WABA_BROADCAST";
  process.env.META_APP_SECRET_BROADCAST = "SECRET_BROADCAST";
  process.env.META_WEBHOOK_VERIFY_TOKEN_BROADCAST = "VERIFY_BROADCAST";
  process.env.WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST = "+13120000002";
}

beforeEach(() => {
  saved = {};
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("getPrimaryAccount", () => {
  it("reads the original unsuffixed env vars", () => {
    setPrimary();
    expect(getPrimaryAccount()).toEqual({
      label: PRIMARY_LABEL,
      phoneNumberId: "PN_PRIMARY",
      accessToken: "TOKEN_PRIMARY",
      wabaId: "WABA_PRIMARY",
      appSecret: "SECRET_PRIMARY",
      verifyToken: "VERIFY_PRIMARY",
      displayNumber: "+13120000001",
    });
  });

  it("throws (lazily) when the phone number id is missing", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN_PRIMARY";
    expect(() => getPrimaryAccount()).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });
});

describe("getBroadcastAccount", () => {
  it("returns null when the broadcast number is not configured", () => {
    setPrimary();
    expect(getBroadcastAccount()).toBeNull();
    expect(getAccounts()).toHaveLength(1);
    expect(getAccounts()[0].label).toBe(PRIMARY_LABEL);
  });

  it("builds the second account from *_BROADCAST vars", () => {
    setPrimary();
    setBroadcast();
    expect(getBroadcastAccount()).toEqual({
      label: BROADCAST_LABEL,
      phoneNumberId: "PN_BROADCAST",
      accessToken: "TOKEN_BROADCAST",
      wabaId: "WABA_BROADCAST",
      appSecret: "SECRET_BROADCAST",
      verifyToken: "VERIFY_BROADCAST",
      displayNumber: "+13120000002",
    });
  });

  it("throws when the broadcast phone id is set but its access token is missing", () => {
    setPrimary();
    process.env.WHATSAPP_PHONE_NUMBER_ID_BROADCAST = "PN_BROADCAST";
    expect(() => getBroadcastAccount()).toThrow(/WHATSAPP_ACCESS_TOKEN_BROADCAST/);
  });
});

describe("account lookups", () => {
  beforeEach(() => {
    setPrimary();
    setBroadcast();
  });

  it("lists both accounts, primary first", () => {
    const accounts = getAccounts();
    expect(accounts.map((a) => a.label)).toEqual([PRIMARY_LABEL, BROADCAST_LABEL]);
  });

  it("resolves by label, phone number id, and WABA id", () => {
    expect(getAccountByLabel(BROADCAST_LABEL)?.phoneNumberId).toBe("PN_BROADCAST");
    expect(getAccountByPhoneNumberId("PN_PRIMARY")?.label).toBe(PRIMARY_LABEL);
    expect(getAccountByWaba("WABA_BROADCAST")?.label).toBe(BROADCAST_LABEL);
    expect(getAccountByPhoneNumberId("PN_UNKNOWN")).toBeUndefined();
    expect(getAccountByWaba("WABA_UNKNOWN")).toBeUndefined();
  });
});
