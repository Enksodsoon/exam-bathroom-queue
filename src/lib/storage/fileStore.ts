import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExamSession } from "@/lib/domain";
import {
  assertValidSessionId,
  parseStoredSession,
  StorageError,
  type MutateResult,
  type SessionMutator,
  type SessionStore,
} from "./types";

const SESSION_LOCKS_SYMBOL = Symbol.for("examq.fileSessionLocks");

function getSessionLocksMap(): Map<string, Promise<void>> {
  const globalStore = globalThis as unknown as Record<
    symbol,
    Map<string, Promise<void>> | undefined
  >;
  let locks = globalStore[SESSION_LOCKS_SYMBOL];
  if (!locks) {
    locks = new Map<string, Promise<void>>();
    globalStore[SESSION_LOCKS_SYMBOL] = locks;
  }
  return locks;
}

const sessionLocks = getSessionLocksMap();
const RETRYABLE_FS_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const MAX_RENAME_ATTEMPTS = 6;

function isNodeErrorWithCode(err: unknown, codes: Set<string>): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    codes.has((err as { code: string }).code)
  );
}

function isNodeErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      if (
        attempt + 1 < MAX_RENAME_ATTEMPTS &&
        isNodeErrorWithCode(err, RETRYABLE_FS_CODES)
      ) {
        await sleep(5 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

export function resolveFileStoreDataDir(dataDir?: string): string {
  const configured =
    dataDir?.trim() ||
    process.env.EXAMQ_DATA_DIR?.trim() ||
    path.join(process.cwd(), ".data", "sessions");
  return path.resolve(/*turbopackIgnore: true*/ configured);
}

export class FileSessionStore implements SessionStore {
  public readonly backendName = "file" as const;
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = resolveFileStoreDataDir(dataDir);
  }

  private sessionPath(sessionId: string): string {
    const id = assertValidSessionId(sessionId);
    const resolved = path.resolve(this.dataDir, `${id}.json`);
    const prefix = this.dataDir.endsWith(path.sep)
      ? this.dataDir
      : `${this.dataDir}${path.sep}`;
    if (!resolved.startsWith(prefix)) {
      throw new StorageError(
        "INVALID_SESSION_ID",
        "Session ID resolves outside storage directory",
      );
    }
    return resolved;
  }

  private async withSessionLock<T>(
    sessionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const id = assertValidSessionId(sessionId);
    const lockKey = `${this.dataDir}\0${id}`;
    const prev = sessionLocks.get(lockKey) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    sessionLocks.set(lockKey, tail);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (sessionLocks.get(lockKey) === tail) {
        sessionLocks.delete(lockKey);
      }
    }
  }

  private async writeAtomic(
    targetPath: string,
    sessionId: string,
    session: ExamSession,
  ): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmpPath = path.join(
      this.dataDir,
      `.${sessionId}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(tmpPath, JSON.stringify(session), "utf8");
      await renameWithRetry(tmpPath, targetPath);
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }

  async create(session: ExamSession): Promise<ExamSession> {
    const targetPath = this.sessionPath(session.id);

    return this.withSessionLock(session.id, async () => {
      await fs.mkdir(this.dataDir, { recursive: true });

      try {
        await fs.access(targetPath);
        throw new StorageError(
          "ALREADY_EXISTS",
          `Session '${session.id}' already exists`,
        );
      } catch (err) {
        if (err instanceof StorageError) {
          throw err;
        }
        if (!isNodeErrorCode(err, "ENOENT")) {
          throw err;
        }
      }

      const payload = JSON.stringify(session);
      const tmpPath = path.join(
        this.dataDir,
        `.${session.id}.${crypto.randomUUID()}.tmp`,
      );
      try {
        await fs.writeFile(tmpPath, payload, "utf8");
        try {
          await fs.link(tmpPath, targetPath);
        } catch (linkErr) {
          if (isNodeErrorCode(linkErr, "EEXIST")) {
            throw new StorageError(
              "ALREADY_EXISTS",
              `Session '${session.id}' already exists`,
            );
          }
          if (
            isNodeErrorCode(linkErr, "ENOTSUP") ||
            isNodeErrorCode(linkErr, "EXDEV")
          ) {
            await renameWithRetry(tmpPath, targetPath);
          } else {
            throw linkErr;
          }
        }
      } finally {
        await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      }

      return parseStoredSession(payload);
    });
  }

  async get(sessionId: string): Promise<ExamSession | null> {
    const targetPath = this.sessionPath(sessionId);

    return this.withSessionLock(sessionId, async () => {
      try {
        const raw = await fs.readFile(targetPath, "utf8");
        return parseStoredSession(raw);
      } catch (err) {
        if (isNodeErrorCode(err, "ENOENT")) {
          return null;
        }
        throw err;
      }
    });
  }

  async mutate<T>(
    sessionId: string,
    mutator: SessionMutator<T>,
  ): Promise<MutateResult<T>> {
    const targetPath = this.sessionPath(sessionId);

    return this.withSessionLock(sessionId, async () => {
      let raw: string;
      try {
        raw = await fs.readFile(targetPath, "utf8");
      } catch (err) {
        if (isNodeErrorCode(err, "ENOENT")) {
          throw new StorageError(
            "NOT_FOUND",
            `Session '${sessionId}' not found`,
          );
        }
        throw err;
      }

      const current = parseStoredSession(raw);
      const { session: nextSession, result } = mutator(current);
      await this.writeAtomic(targetPath, current.id, nextSession);
      return { session: nextSession, result };
    });
  }
}
