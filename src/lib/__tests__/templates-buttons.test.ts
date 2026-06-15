import { describe, expect, it } from "vitest";

import { buildSendComponents, describeTemplate, resolveBindings, type TemplateDescriptor, type VariableBindings } from "@/lib/whatsapp/templates";

// Minimal descriptor for button-only tests (no body/header/url vars).
const emptyDesc: TemplateDescriptor = {
  name: "ashara_relay_double_rsvp",
  language: "en_US",
  category: null,
  bodyText: null,
  bodyVars: [],
  bodyVarCount: 0,
  named: true,
  header: null,
  headerVar: null,
  urlButtons: [],
  flowButtons: [{ index: 0, text: "Attending" }],
};

const doubleRsvpButtons: VariableBindings = {
  body: {},
  buttons: [
    {
      type: "flow",
      index: 0,
      flowToken: "rsvp:{{Person.Id}}:{{RegistrationInstanceId}}",
      flowActionData: { person_id: "{{Person.Id}}", registration_instance_id: "{{RegistrationInstanceId}}", attending_count: "{{EligibleFamilyCount}}" },
    },
    { type: "quick_reply", index: 1, payload: "not-attending-{{Person.Id}}-{{RegistrationInstanceId}}" },
  ],
  buttonTokens: { RegistrationInstanceId: "e1" },
};

describe("describeTemplate — Flow buttons", () => {
  it("detects FLOW buttons alongside URL buttons", () => {
    const desc = describeTemplate({
      name: "ashara_relay_double_rsvp",
      language: "en_US",
      status: "APPROVED",
      components: [
        { type: "BODY", text: "Salaam {{name}}" },
        { type: "BUTTONS", buttons: [{ type: "FLOW", text: "Attending" }, { type: "QUICK_REPLY", text: "Not attending" }] },
      ],
    });
    expect(desc.flowButtons).toEqual([{ index: 0, text: "Attending" }]);
  });
});

describe("resolveBindings — per-recipient button payloads", () => {
  it("substitutes tokens against the recipient row + static tokens", () => {
    const { inputs, skipReason } = resolveBindings(emptyDesc, doubleRsvpButtons, { mumin_id: "m1", eligible_family_count: "4" });
    expect(skipReason).toBeUndefined();
    expect(inputs.flowButtons).toEqual([
      { index: 0, flowToken: "rsvp:m1:e1", flowActionData: { person_id: "m1", registration_instance_id: "e1", attending_count: 4 } },
    ]);
    expect(inputs.quickReplyButtons).toEqual([{ index: 1, payload: "not-attending-m1-e1" }]);
  });

  it("skips a recipient when a required button token is missing", () => {
    const { skipReason } = resolveBindings(emptyDesc, doubleRsvpButtons, { eligible_family_count: "4" }); // no mumin_id
    expect(skipReason).toBe("missing Person.Id");
  });
});

describe("buildSendComponents — Flow button component", () => {
  it("emits a sub_type 'flow' button with the action flow_token + flow_action_data", () => {
    const components = buildSendComponents(
      {
        flowButtons: [{ index: 0, flowToken: "rsvp:m1:e1", flowActionData: { person_id: "m1", attending_count: 4 } }],
        quickReplyButtons: [{ index: 1, payload: "not-attending-m1-e1" }],
      },
      emptyDesc,
    ) as Array<Record<string, unknown>>;

    const flow = components.find((c) => c.sub_type === "flow");
    expect(flow).toEqual({
      type: "button",
      sub_type: "flow",
      index: "0",
      parameters: [{ type: "action", action: { flow_token: "rsvp:m1:e1", flow_action_data: { person_id: "m1", attending_count: 4 } } }],
    });
    const quick = components.find((c) => c.sub_type === "quick_reply");
    expect(quick).toMatchObject({ index: "1", parameters: [{ type: "payload", payload: "not-attending-m1-e1" }] });
  });
});
