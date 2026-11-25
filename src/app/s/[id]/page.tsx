import { SessionWorkspace } from "@/components/SessionWorkspace";
import { isControllerKeyValid } from "@/lib/api/http";
import { getSessionStore, StorageError } from "@/lib/storage";

export const dynamic = "force-dynamic";

interface SessionPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string | string[] }>;
}

export default async function SessionPage({
  params,
  searchParams,
}: SessionPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const rawKey = resolvedSearchParams.key;
  const rawKeyParam = Array.isArray(rawKey)
    ? (rawKey[0] ?? null)
    : (rawKey ?? null);
  const trimmedRawKey =
    rawKeyParam && rawKeyParam.trim().length > 0 ? rawKeyParam.trim() : null;

  let session = null;
  try {
    session = await getSessionStore().get(id);
  } catch (err) {
    if (err instanceof StorageError && err.code === "INVALID_SESSION_ID") {
      session = null;
    } else {
      throw err;
    }
  }

  if (!session) {
    return (
      <SessionWorkspace
        sessionId={id}
        initialKey={null}
        initialNotFound={true}
        initialKeyRejected={false}
      />
    );
  }

  if (trimmedRawKey === null) {
    return (
      <SessionWorkspace
        sessionId={id}
        initialKey={null}
        initialNotFound={false}
        initialKeyRejected={false}
      />
    );
  }

  const validKey = isControllerKeyValid(session.controllerKey, trimmedRawKey);
  return (
    <SessionWorkspace
      sessionId={id}
      initialKey={validKey ? trimmedRawKey : null}
      initialNotFound={false}
      initialKeyRejected={!validKey}
    />
  );
}
