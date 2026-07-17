/// <reference types="@figma/plugin-typings" />

/**
 * Bumped on every new plugin "run" invocation and again on "close", so a
 * long-running background loop from a previous invocation (a big library
 * import/update, a full-document scan) can notice it's been superseded —
 * by the user re-triggering the plugin via a relaunch button/menu command
 * mid-operation, or by closing the plugin outright — and stop touching the
 * document or posting to a UI that may no longer be listening, instead of
 * silently grinding on in the background.
 */
let token = 0;

export function bumpRunToken(): number {
  return ++token;
}

export function currentRunToken(): number {
  return token;
}

export function isStaleRun(startedAtToken: number): boolean {
  return startedAtToken !== token;
}
