// "Listen" buttons: read a transcript aloud with the Web Speech API, one utterance per line
// (long single utterances get cut off in some browsers). Only one transcript plays at a time.
// Each utterance reports when it starts, so the UI can highlight the line being spoken, like captions.

import { toSpeechLines } from "./format.js";

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
export const SPEECH_SUPPORTED = Boolean(synth && typeof SpeechSynthesisUtterance !== "undefined");

let voice = null;
let current = null; // { onStop }

function pickVoice() {
  if (!SPEECH_SUPPORTED) return null;
  const voices = synth.getVoices();
  return (
    voices.find((v) => v.lang === "en-US" && v.localService) ??
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ??
    null
  );
}

if (SPEECH_SUPPORTED) {
  voice = pickVoice();
  synth.addEventListener?.("voiceschanged", () => {
    voice = pickVoice();
  });
}

/** Stop whatever is playing and notify its owner. */
export function stopSpeaking() {
  if (!SPEECH_SUPPORTED) return;
  const was = current;
  current = null;
  synth.cancel();
  was?.onStop();
}

/**
 * Speak `heard`. `onLine(index)` is called when the sentence of transcript line `index` starts
 * (indices as in tokenizeTranscript). `onStop` is called once when playback ends, is stopped, or is
 * replaced by another transcript.
 */
export function speak(heard, onStop, onLine) {
  if (!SPEECH_SUPPORTED) return false;
  stopSpeaking();
  const lines = toSpeechLines(heard);
  if (!lines.length) return false;
  const session = { onStop };
  current = session;
  lines.forEach(({ line: index, text }, i) => {
    const u = new SpeechSynthesisUtterance(text);
    if (onLine) {
      u.addEventListener("start", () => {
        if (current === session) onLine(index);
      });
    }
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    u.rate = 1.2;
    if (i === lines.length - 1) {
      const end = () => {
        if (current === session) {
          current = null;
          onStop();
        }
      };
      u.addEventListener("end", end);
      u.addEventListener("error", end);
    }
    synth.speak(u);
  });
  return true;
}
