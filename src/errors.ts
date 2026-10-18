/** Machine-readable failure reason surfaced to the agent so it can decide what to do. */
export type Reason =
  | "rate_limited"
  | "login_required"
  | "not_found"
  | "unavailable"
  | "no_audio"
  | "setup"
  | "timeout"
  | "failed";

export class ReelsError extends Error {
  constructor(
    message: string,
    public readonly reason: Reason,
  ) {
    super(message);
  }
}
