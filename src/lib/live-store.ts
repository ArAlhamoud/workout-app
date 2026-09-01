import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  isLiveFresh,
  mergeLiveSets,
  type LiveSession,
  type LiveSet,
  type LiveSetUpdate,
  type LiveSource,
} from './live-session';

/**
 * Server side of the live session (docs/WATCH.md "Live session"). Every
 * function is tolerant of the table not existing yet — the schema ships
 * through the Apply-schema Action ahead of the code, but a deploy must
 * never 500 the logger if that order slips.
 */

type Row = {
  clientSaveId: string;
  day: string | null;
  durationMin: number | null;
  gym: string | null;
  source: string;
  startedAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  workoutId: string | null;
  sets: Prisma.JsonValue;
};

function toSession(r: Row): LiveSession {
  return {
    clientSaveId: r.clientSaveId,
    day: r.day === 'A' || r.day === 'B' ? r.day : null,
    durationMin: r.durationMin,
    gym: r.gym,
    source: r.source === 'watch' ? 'watch' : 'phone',
    startedAt: r.startedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    workoutId: r.workoutId,
    sets: Array.isArray(r.sets) ? (r.sets as unknown as LiveSet[]) : [],
  };
}

/** The open, fresh session — or null. With an id: that row whatever its state. */
export async function readLive(id?: string, now: Date = new Date()): Promise<LiveSession | null> {
  try {
    if (id) {
      const r = await prisma.liveSession.findUnique({ where: { clientSaveId: id } });
      return r ? toSession(r) : null;
    }
    const rows = await prisma.liveSession.findMany({
      where: { closedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    });
    const fresh = rows.find((r) => isLiveFresh(r, now));
    return fresh ? toSession(fresh) : null;
  } catch {
    return null;
  }
}

export interface LiveMeta {
  clientSaveId: string;
  source: LiveSource;
  day?: 'A' | 'B' | null;
  durationMin?: number | null;
  gym?: string | null;
  startedAt?: string | null;
}

/**
 * Create-or-merge. Opening a NEW id closes every other open row: one user,
 * one session at a time — the stale one is a leftover, not a rival. A
 * post against a CLOSED id is answered with the row (closed: true) and
 * nothing written: the other device finished; the caller should stop.
 */
export async function upsertLive(meta: LiveMeta, updates: LiveSetUpdate[]): Promise<LiveSession | null> {
  try {
    const existing = await prisma.liveSession.findUnique({ where: { clientSaveId: meta.clientSaveId } });
    if (existing?.closedAt) return toSession(existing);
    const startedAt = meta.startedAt ? new Date(meta.startedAt) : existing?.startedAt ?? new Date();
    const sets = mergeLiveSets(existing ? toSession(existing).sets : [], updates);
    const data = {
      day: meta.day ?? existing?.day ?? null,
      durationMin: meta.durationMin ?? existing?.durationMin ?? null,
      gym: meta.gym ?? existing?.gym ?? null,
      source: existing?.source ?? meta.source,
      startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
      sets: sets as unknown as Prisma.InputJsonValue,
    };
    const [row] = await prisma.$transaction([
      prisma.liveSession.upsert({
        where: { clientSaveId: meta.clientSaveId },
        create: { clientSaveId: meta.clientSaveId, ...data },
        update: data,
      }),
      prisma.liveSession.updateMany({
        where: { closedAt: null, clientSaveId: { not: meta.clientSaveId } },
        data: { closedAt: new Date() },
      }),
    ]);
    return toSession(row);
  } catch {
    return null;
  }
}

/** Finished or discarded anywhere: the other device clears itself on its next read. */
export async function closeLive(clientSaveId: string, workoutId?: string | null): Promise<void> {
  try {
    await prisma.liveSession.updateMany({
      where: { clientSaveId, closedAt: null },
      data: { closedAt: new Date(), workoutId: workoutId ?? undefined },
    });
  } catch {
    /* no table yet, or nothing open — either way there is nothing to close */
  }
}
