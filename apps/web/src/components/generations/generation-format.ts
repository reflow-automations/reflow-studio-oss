/** Pure helpers shared by server components (detail page) and client components (cards). */

export function aspectRatioStyle(ratio: string | undefined): string {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio ?? "");
  return match ? `${match[1]} / ${match[2]}` : "1 / 1";
}

export function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error && typeof (error as { message: unknown }).message === "string") return (error as { message: string }).message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Failed";
  }
}
