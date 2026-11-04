import type { Brain, BrainTurn, ToolCall, ToolOutcome } from "./brain.js";

// A brain that follows a fixed plan, used by tests and for demos without an API key.
// Each plan step looks at the latest transcript and returns the tool calls for that turn.

export interface TranscriptElement {
  id: number;
  role: string;
  name: string;
}

export function parseTranscript(transcript: string): TranscriptElement[] {
  const out: TranscriptElement[] = [];
  for (const line of transcript.split("\n")) {
    const m = /^\s*\[(\d+)\] (.+?) ("(?:[^"\\]|\\.)*")/.exec(line);
    if (m) out.push({ id: Number(m[1]), role: m[2], name: JSON.parse(m[3]) as string });
  }
  return out;
}

export type PlanStep = (transcript: string, find: Finder) => Omit<ToolCall, "id">[];
export type Finder = (role: string, name?: RegExp) => TranscriptElement | undefined;

export class ScriptedBrain implements Brain {
  readonly model = "scripted";
  private step = 0;
  private transcript = "";
  private counter = 0;

  constructor(private readonly plan: PlanStep[]) {}

  start(_task: string, transcript: string): Promise<BrainTurn> {
    this.transcript = transcript;
    return this.next();
  }

  continue(outcomes: ToolOutcome[]): Promise<BrainTurn> {
    // The last outcome of an action carries the new transcript after "Screen reader transcript:".
    for (const o of outcomes) {
      const i = o.content.indexOf("Screen reader transcript:\n");
      if (i >= 0) this.transcript = o.content.slice(i + "Screen reader transcript:\n".length);
    }
    return this.next();
  }

  nudge(): Promise<BrainTurn> {
    return this.next();
  }

  private async next(): Promise<BrainTurn> {
    const els = parseTranscript(this.transcript);
    const find: Finder = (role, name) => els.find((e) => e.role === role && (name ? name.test(e.name) : true));
    const planStep = this.plan[Math.min(this.step, this.plan.length - 1)];
    this.step++;
    const calls = planStep(this.transcript, find).map((c) => ({ ...c, id: `scripted_${++this.counter}` }));
    return { calls, text: "" };
  }
}

const blockedOnTime = (): Omit<ToolCall, "id">[] => [
  {
    name: "report_issue",
    input: {
      severity: "critical",
      title: "Time slots cannot be selected",
      description: "The available times are announced as plain text. There is no button, radio button or link to choose one, so a screen reader user cannot pick a time and cannot book.",
      wcag: ["2.1.1 Keyboard", "4.1.2 Name, Role, Value"],
      fix: '<fieldset>\n  <legend>Available times</legend>\n  <input type="radio" id="t900" name="time" value="09:00"><label for="t900">9:00</label>\n</fieldset>',
      element_id: null,
      blocking: true,
    },
  },
  {
    name: "finish",
    input: {
      status: "blocked",
      summary: "I reached the booking form and chose a doctor and a date, but the time slots are only announced as text, so I could not select one and the appointment could not be booked. Make the time slots a radio group, and give the submit button and form fields proper labels.",
    },
  },
];

/** Plan for the demo clinic: book with Dr. Lee as Alex Doe. Works on both demo versions. */
export const clinicDemoPlan: PlanStep[] = [
  (_t, find) => {
    const link = find("link", /book an appointment/i) ?? find("link", /book/i);
    return link
      ? [{ name: "click", input: { id: link.id, reason: `I hear link "${link.name}", which should take me to the booking form.` } }]
      : [{ name: "finish", input: { status: "blocked", summary: "I could not find a way to the booking form." } }];
  },
  (_t, find) => {
    const named = find("combobox", /doctor/i);
    const cb = named ?? find("combobox");
    if (!cb) return [{ name: "finish", input: { status: "blocked", summary: "I could not find where to choose the doctor." } }];
    const calls: Omit<ToolCall, "id">[] = [];
    if (!named) {
      calls.push({
        name: "report_issue",
        input: {
          severity: "serious",
          title: "Doctor list has no label",
          description: 'The drop-down is announced only as combobox "", so I had to guess from its options that it is the doctor choice.',
          wcag: ["1.3.1 Info and Relationships", "4.1.2 Name, Role, Value"],
          fix: '<label for="doctor">Doctor</label>\n<select id="doctor">…</select>',
          element_id: cb.id,
          blocking: false,
        },
      });
    }
    calls.push({ name: "select_option", input: { id: cb.id, option: "Dr. Lee", reason: "This list contains the doctors; I choose Dr. Lee." } });
    return calls;
  },
  (_t, find) => {
    const date = find("textbox", /date/i);
    return date
      ? [{ name: "type_text", input: { id: date.id, text: "2026-12-15", reason: `I fill in textbox "${date.name}".` } }]
      : [{ name: "finish", input: { status: "blocked", summary: "I could not find the date field." } }];
  },
  (_t, find) => {
    const slot = find("radio", /9[:.]00/) ?? find("radio") ?? find("button", /\d{1,2}[:.]\d{2}/);
    if (!slot) return blockedOnTime();
    return [{ name: "click", input: { id: slot.id, reason: `I choose the time ${slot.name}.` } }];
  },
  (_t, find) => {
    const name = find("textbox", /name/i);
    return name
      ? [{ name: "type_text", input: { id: name.id, text: "Alex Doe", reason: `I type my name into textbox "${name.name}".` } }]
      : [{ name: "finish", input: { status: "blocked", summary: "I could not find the name field." } }];
  },
  (_t, find) => {
    const email = find("textbox", /e-?mail/i) ?? find("textbox", /^$/);
    return email
      ? [{ name: "type_text", input: { id: email.id, text: "alex@example.com", reason: `I type my email into textbox "${email.name}".` } }]
      : [{ name: "finish", input: { status: "blocked", summary: "I could not find the email field." } }];
  },
  (_t, find) => {
    const submit = find("button", /book|submit|confirm/i) ?? find("button", /^$/);
    return submit
      ? [{ name: "click", input: { id: submit.id, reason: `I submit the form with button "${submit.name}".` } }]
      : [{ name: "finish", input: { status: "blocked", summary: "I could not find a button to submit the form." } }];
  },
  (t) =>
    /confirmed/i.test(t)
      ? [{ name: "finish", input: { status: "success", summary: "I booked an appointment with Dr. Lee as Alex Doe. Every step was announced clearly and the confirmation page told me the booking was done." } }]
      : [{ name: "finish", input: { status: "blocked", summary: "I submitted the form but no confirmation was announced." } }],
];
