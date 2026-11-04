// Types for format.js, so TypeScript tests (tests/report-ui.test.ts) can import it under `strict`.

export type Severity = "critical" | "serious" | "moderate" | "minor";

export interface ActionLike {
  type?: string;
  target?: { id?: number; role: string; name?: string };
  value?: string;
}

export interface IssueLike {
  severity: string;
  blocking?: boolean;
  stepIndex?: number;
}

export type Segment = { text: string } | { el: { role: string; name: string } } | { value: string };

export interface TranscriptToken {
  kind: "id" | "empty" | "text";
  text: string;
}

export interface TranscriptLine {
  tokens: TranscriptToken[];
  ids: number[];
  firstId: number | null;
}

export const SEVERITY_ORDER: Severity[];
export const STATUS_LABELS: Record<string, string>;
export function statusLabel(status: string | undefined): string;
export function statusTone(status: string | undefined): "good" | "bad" | "warn" | "info";
export function scoreTone(score: number | undefined): "good" | "warn" | "bad" | "none";
export function scoreVerdict(score: number | undefined, status?: string): string;
export function sortIssues<T extends IssueLike>(issues: T[] | undefined): T[];
export function countBySeverity(issues: IssueLike[] | undefined): Record<Severity, number>;
export function actionSegments(action: ActionLike | undefined): Segment[];
export function actionText(action: ActionLike | undefined): string;
export function stripIds(text: string | undefined): string;
export function toSpeech(heard: string | undefined): string[];
export function tokenizeTranscript(heard: string | undefined): TranscriptLine[];
export function relativeTime(iso: string, now?: number): string;
export function duration(startIso: string | undefined, endIso: string | undefined): string;
export function screenshotUrl(reportId: string, file: string | undefined, base?: string): string | null;
export function demoSiteHref(url: string | undefined): string | null;
export function prettyUrl(url: string | undefined): string;

export interface MatchableIssue extends IssueLike {
  title: string;
  element?: { role: string; name: string };
}
export function issueMatchKey(issue: MatchableIssue | undefined): string;
export function compareIssues<T extends MatchableIssue>(
  beforeIssues: T[] | undefined,
  afterIssues: T[] | undefined,
): { fixed: T[]; stillPresent: { before: T; after: T }[]; added: T[] };
export function orderRuns<T extends { startedAt?: string }>(a: T, b: T): [T, T];
export function scoreDelta(
  before: number | undefined,
  after: number | undefined,
): { value: number | null; text: string; tone: "good" | "bad" | "none"; sentence: string };
