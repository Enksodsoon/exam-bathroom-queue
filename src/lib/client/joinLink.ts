export function resolveExamJoinPath(
  rawInput: string,
  origin: string,
  requireStaffInvite = false,
): string | null {
  const value = rawInput.trim();
  if (!value) return null;
  if (!requireStaffInvite && /^[A-Za-z0-9_-]+$/.test(value)) {
    return `/s/${encodeURIComponent(value)}`;
  }

  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return null;
    const match = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
    if (!match) return null;
    const invite = url.searchParams.get("invite")?.trim();
    if (requireStaffInvite && (!invite || url.searchParams.has("key"))) return null;
    const path = `/s/${encodeURIComponent(match[1])}`;
    return invite ? `${path}?${new URLSearchParams({ invite })}` : path;
  } catch {
    return null;
  }
}
