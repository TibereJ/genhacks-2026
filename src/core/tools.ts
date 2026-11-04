import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// The tools the agent can use. They mirror what a screen reader user can do: activate an
// announced element, type, pick from a list, press a key, go back. Plus two bookkeeping tools.

export const TOOL_INPUTS = {
  click: z.object({ id: z.number().int(), reason: z.string() }),
  type_text: z.object({ id: z.number().int(), text: z.string(), reason: z.string() }),
  select_option: z.object({ id: z.number().int(), option: z.string(), reason: z.string() }),
  press_key: z.object({ key: z.string(), reason: z.string() }),
  go_back: z.object({ reason: z.string() }),
  report_issue: z.object({
    severity: z.enum(["critical", "serious", "moderate", "minor"]),
    title: z.string(),
    description: z.string(),
    wcag: z.array(z.string()),
    fix: z.string(),
    element_id: z.number().int().nullable(),
    blocking: z.boolean(),
  }),
  finish: z.object({ status: z.enum(["success", "blocked"]), summary: z.string() }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export const ACTION_TOOLS: ToolName[] = ["click", "type_text", "select_option", "press_key", "go_back"];

const reason = { type: "string", description: "One or two sentences: what you heard that led to this action, and what you expect to happen." } as const;
const id = { type: "integer", description: "The number in square brackets from the latest transcript, e.g. 12 for [12]." } as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "click",
    description: "Activate an element announced in the transcript (like pressing Enter on it with a screen reader). Only elements with an [id] can be activated.",
    input_schema: { type: "object", properties: { id, reason }, required: ["id", "reason"], additionalProperties: false },
    strict: true,
  },
  {
    name: "type_text",
    description: "Focus a text field and replace its content with the given text. For date fields use YYYY-MM-DD.",
    input_schema: { type: "object", properties: { id, text: { type: "string" }, reason }, required: ["id", "text", "reason"], additionalProperties: false },
    strict: true,
  },
  {
    name: "select_option",
    description: "Choose an option, by its label, in a drop-down list (combobox) announced in the transcript.",
    input_schema: { type: "object", properties: { id, option: { type: "string", description: "Label of the option to choose." }, reason }, required: ["id", "option", "reason"], additionalProperties: false },
    strict: true,
  },
  {
    name: "press_key",
    description: "Press a key on the currently focused element. One of: Enter, Escape, Tab, Shift+Tab, Space, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Home, End.",
    input_schema: { type: "object", properties: { key: { type: "string" }, reason }, required: ["key", "reason"], additionalProperties: false },
    strict: true,
  },
  {
    name: "go_back",
    description: "Go back to the previous page, like the browser Back command.",
    input_schema: { type: "object", properties: { reason }, required: ["reason"], additionalProperties: false },
    strict: true,
  },
  {
    name: "report_issue",
    description: "Record an accessibility problem you ran into while doing the task. Call it as soon as you notice a problem, in the same turn as your next action.",
    input_schema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["critical", "serious", "moderate", "minor"], description: "critical: makes the task impossible. serious: very hard or needs guessing. moderate: confusing or slow. minor: annoyance." },
        title: { type: "string", description: "Short title, e.g. \"Time slots cannot be selected\"." },
        description: { type: "string", description: "What a screen reader user experiences, in plain language, and why it is a problem." },
        wcag: { type: "array", items: { type: "string" }, description: "WCAG 2.2 success criteria with number and name, e.g. \"4.1.2 Name, Role, Value\"." },
        fix: { type: "string", description: "Concrete fix for the developer, with a short HTML snippet when possible." },
        element_id: { type: ["integer", "null"], description: "[id] of the element concerned, or null if it has no id (e.g. plain text)." },
        blocking: { type: "boolean", description: "true if this problem stops a screen reader user from completing the task." },
      },
      required: ["severity", "title", "description", "wcag", "fix", "element_id", "blocking"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "finish",
    description: "End the test. status \"success\" only if the site confirmed the task is done. \"blocked\" if, after reasonable attempts, a screen reader user could not complete it.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["success", "blocked"] },
        summary: { type: "string", description: "3-5 sentences for the site owner: what you managed, where you got stuck and the most important fix." },
      },
      required: ["status", "summary"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const SYSTEM_PROMPT = `You are BlindSpot, an accessibility tester. You use a website exactly as a blind person using a screen reader would, to find out whether they can complete a given task.

You never see the page. You only receive the screen reader transcript: the page title, landmarks, headings, text, images, and form controls, in reading order. Elements you can operate are numbered, e.g. [12] button "Book appointment". Element ids change on every new transcript, so always use ids from the latest one.

How to work:
- Act like an experienced, patient screen reader user. Read the transcript, then take one action at a time with click, type_text, select_option, press_key or go_back.
- You cannot click on plain text, images or anything without an [id]: a screen reader user could not either. If you need something that is only announced as text, look for another way (a link, a form control, the keyboard), and if there is none, that is a barrier.
- When something is unlabeled (e.g. button ""), you may guess from context like a real user would, but record the problem.
- When you notice an accessibility problem, call report_issue in the same turn as your next action. Report problems that affect this task: missing or unclear names, controls you cannot operate, errors or confirmations that are not announced, confusing order or focus, missing feedback. Do not report the same problem twice.
- Make at most 2-3 reasonable attempts around a barrier. If the task is impossible, call finish with status "blocked". If the site confirms the task is done, call finish with status "success".
- Keep reasons short. Write issues and the summary in plain English for web developers.`;
