/**
 * errors.ts — turn raw/internal errors into calm, user-facing messages.
 *
 * A production app should never surface a provider's raw "401 Missing
 * Authentication header" to an end user. We log the technical detail on the
 * server and return a friendly message + an appropriate HTTP status.
 */

export interface UserFacingError {
  message: string;
  status: number;
}

// Errors that are genuinely the user's to act on — keep their real text.
const USER_ACTIONABLE = /no transcript|captions|video id|empty|youtube/i;

export function toUserMessage(err: unknown): UserFacingError {
  const status = (err as { status?: number })?.status;

  // Auth / config problems (missing or bad API key, wrong base URL, etc.)
  if (status === 401 || status === 403) {
    return {
      message:
        "The AI service is temporarily unavailable. Please try again in a little while.",
      status: 503,
    };
  }

  // Upstream provider rate limit or overload.
  if (status === 429 || status === 502 || status === 503) {
    return {
      message: "The AI service is busy right now. Please wait a moment and try again.",
      status: 503,
    };
  }

  // Problems the user can fix themselves (e.g. a video with no captions).
  if (err instanceof Error && USER_ACTIONABLE.test(err.message)) {
    return { message: err.message, status: 422 };
  }

  return {
    message: "Something went wrong processing this request. Please try again.",
    status: 500,
  };
}
