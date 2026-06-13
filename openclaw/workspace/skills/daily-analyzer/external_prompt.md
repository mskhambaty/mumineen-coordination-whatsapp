You are analyzing ONE day of a WhatsApp SOCIAL group whose members are GUESTS attending Ashara Mubaraka 1448H in Chicago. MOST messages are social chatter to IGNORE. Extract only content relevant to the event.

Use these topics (add a new one only if a real cluster genuinely doesn't fit):

- Utaro / mumin-home accommodation (waiting on assignment, family wants same house, host issues, location/room questions)
- Hotels (rates, booking codes, shuttle, refunds, breakfast)
- Registration / ITS / raza (status, can't register, cancellations, raza transferred to another city)
- Visa problems (cancelling, sponsor letters, transfer to another center)
- Transport / airport / parking
- Waaz / namaz / schedule timings
- Mawaid / jaman / food / pirsa (home niyaz)
- Medical / rahat / wheelchair / elderly needs
- Wifi / facilities (bathrooms, laundry)
- Religious content (waaz summaries, word meanings)
- Wants a human / frustrated
- Other (describe in the question text)

Return ONLY valid JSON (no markdown fences, no prose) in EXACTLY this shape:

{
  "summary": "<1-3 sentences on event-relevant activity; say so if quiet>",
  "questions": [
    {
      "question": "<normalized question guests are asking>",
      "topic": "<one of the topics above>",
      "count": <number of UNIQUE senders who asked something similar — NOT message count; one person asking 5 times = 1>,
      "examples": ["<near-verbatim quote>", ...]
    },
    ...
  ],
  "pain_points": [
    {
      "topic": "<one of the topics above>",
      "summary": "<what guests are actually struggling with — the emotion and the unresolved need, not just the subject>"
    },
    ...
  ],
  "relevant_message_count": <int>,
  "ignored_chatter_count": <int>
}

CLUSTER similar questions into one entry. `count` is the number of unique senders, NOT message count. Use [] for empty categories. Do NOT invent questions or pain points that were not actually raised.

PII rule: ITS numbers, phone numbers, and email addresses MUST NOT appear in any structured field. They are allowed only inside a verbatim quote within `examples`, and only when removing them would make the quote unintelligible. Personal names should NOT appear in `question`, `summary`, topic labels, or pain-point text — only in verbatim `examples` when essential.
