import { afterEach, describe, expect, it, vi } from "vitest";

import { allToolDefinitions, updateTasksFromAgent } from "@/lib/agent/tools";
import { getToolMetadata } from "@/lib/agent/tool-metadata";
import { resolveUniqueName, selectTasksForAgentUpdate } from "@/lib/tasks/agent-management";

const tasks = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Integrate hotel info Google Sheet into AI bot",
    description: null,
    status: "open",
    priority: "medium",
    archived: false,
    department_id: "it",
    departments: { name: "IT" },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Prepare Content for AI Helpdesk Mehmaan Service",
    description: null,
    status: "open",
    priority: "high",
    archived: false,
    department_id: "it",
    departments: { name: "IT" },
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Accommodation request follow-up delay",
    description: null,
    status: "open",
    priority: "medium",
    archived: false,
    department_id: null,
    departments: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Volunteers scheduling",
    description: null,
    status: "open",
    priority: "medium",
    archived: false,
    department_id: "sabeel",
    departments: { name: "Sabeel" },
  },
];

describe("selectTasksForAgentUpdate", () => {
  it("resolves topic matches internally so an update does not need a prior ID lookup", () => {
    const result = selectTasksForAgentUpdate(tasks, { query: "AI bot related tickets", all_matching: true });

    expect(result.error).toBeUndefined();
    expect(result.selected.map((task) => task.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("treats AI as a word instead of matching unrelated text such as email", () => {
    const result = selectTasksForAgentUpdate(
      [...tasks, { ...tasks[0], id: "55555555-5555-4555-8555-555555555555", title: "Send committee email" }],
      { query: "AI tickets", all_matching: true },
    );

    expect(result.selected.map((task) => task.title)).not.toContain("Send committee email");
  });

  it("supports explicit exclusions for bulk actions", () => {
    const result = selectTasksForAgentUpdate(tasks, {
      statuses: ["open"],
      exclude_department_names: ["Sabeel"],
      all_matching: true,
    });

    expect(result.selected.map((task) => task.title)).not.toContain("Volunteers scheduling");
    expect(result.selected).toHaveLength(3);
  });

  it("blocks ambiguous bulk writes unless the user explicitly requested all matches", () => {
    const result = selectTasksForAgentUpdate(tasks, { statuses: ["open"], all_matching: false });

    expect(result.selected).toEqual([]);
    expect(result.error).toContain("matched 4 tickets");
  });

  it("requires a selector instead of allowing an accidental update-everything call", () => {
    const result = selectTasksForAgentUpdate(tasks, { all_matching: true });

    expect(result.error).toContain("Select tickets");
  });
});

describe("resolveUniqueName", () => {
  const departments = [
    { id: "1", name: "Accommodation" },
    { id: "2", name: "IT" },
  ];

  it("resolves an unambiguous partial department name", () => {
    expect(resolveUniqueName(departments, "accom", "Department").item?.id).toBe("1");
  });
});

describe("task tool catalog", () => {
  it("exposes the consolidated ticket-management tools instead of fragmented legacy calls", () => {
    const names = allToolDefinitions.map((tool) => tool.type === "function" ? tool.function.name : "");
    const metadataNames = Object.keys(getToolMetadata());

    expect(names).toEqual(expect.arrayContaining([
      "list_tasks",
      "list_departments",
      "list_department_members",
      "create_task",
      "update_tasks",
    ]));
    expect(metadataNames).toEqual(expect.arrayContaining(["list_tasks", "list_departments", "list_department_members", "update_tasks"]));
    expect(names).not.toEqual(expect.arrayContaining(["get_my_tasks", "update_task_status", "assign_task"]));
    expect(metadataNames).not.toEqual(expect.arrayContaining(["get_my_tasks", "update_task_status", "assign_task"]));
  });
});

describe("updateTasksFromAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds IDs and closes topic-matched tickets in the same tool call", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/tasks?")) {
        return Response.json(tasks);
      }
      if (url.includes("/api/tasks/11111111-1111-4111-8111-111111111111") || url.includes("/api/tasks/22222222-2222-4222-8222-222222222222")) {
        return Response.json({ id: url.split("/").at(-1), status: "complete" });
      }
      return Response.json({ error: "unexpected request", init }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateTasksFromAgent(
      {
        selection: { query: "AI bot related tickets", statuses: ["open"], all_matching: true },
        updates: { status: "complete" },
      },
      {
        user: { role: "admin", phone_e164: "+10000000000" },
        phoneE164: "+10000000000",
      },
    ) as { updated_count: number; failed_count: number };

    expect(result).toMatchObject({ updated_count: 2, failed_count: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const putBodies = fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)));
    expect(putBodies).toEqual([{ status: "complete" }, { status: "complete" }]);
  });
});
