export interface Submission {
  sessionID: string | null;
  readonly signal: AbortSignal;
}

/** Owns preparation only. A POST already in flight is never replayed or abandoned. */
export class SubmissionLifecycle {
  private active?: { submission: Submission; abort: AbortController; dispatched: boolean };

  begin(sessionID: string | null): Submission {
    this.cancel();
    const abort = new AbortController();
    const submission = { sessionID, signal: abort.signal };
    this.active = { submission, abort, dispatched: false };
    return submission;
  }

  owns(submission: Submission): boolean {
    return this.active?.submission === submission;
  }

  finish(submission: Submission): boolean {
    if (!this.owns(submission)) return false;
    this.active = undefined;
    return true;
  }

  dispatched(submission: Submission): void {
    if (this.active?.submission === submission) this.active.dispatched = true;
  }

  cancel(sessionID?: string): boolean {
    if (!this.active || (sessionID !== undefined && this.active.submission.sessionID !== sessionID)) return false;
    // Stop may withdraw preparation, but an accepted POST still owns its
    // acknowledgement/cleanup. Navigation may detach its UI ownership.
    if (sessionID !== undefined && this.active.dispatched) return false;
    this.active.abort.abort(new DOMException('Preparation cancelled', 'AbortError'));
    this.active = undefined;
    return true;
  }
}
