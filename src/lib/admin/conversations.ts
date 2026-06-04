type PhoneRow = {
  phone_e164: string | null;
  created_at: string;
};

export type DirectionalMessage = {
  direction: "inbound" | "outbound";
};

export function groupRowsByPhoneChronologically<T extends PhoneRow>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.phone_e164) continue;
    const existing = grouped.get(row.phone_e164) ?? [];
    existing.push(row);
    grouped.set(row.phone_e164, existing);
  }

  for (const messages of grouped.values()) {
    messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  return grouped;
}

export function countUnreadInbound<T extends DirectionalMessage>(messages: T[]) {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.direction === "outbound") break;
    if (message.direction === "inbound") count++;
  }
  return count;
}
