import "server-only";

export type AdmissionRefusalReason = "QUEUE_FULL" | "TIMEOUT" | "ABORTED";
export class AdmissionRefused extends Error {
  constructor(public reason: AdmissionRefusalReason) { super(`Admission refused: ${reason}`); }
}

export interface SemaphoreOptions { maxActive: number; maxQueued: number; maxWaitMs: number }
export interface Semaphore {
  // Resolves to a release function. Release is idempotent; abort only affects a queued wait.
  acquire(signal?: AbortSignal): Promise<() => void>;
  stats(): { active: number; queued: number };
}

interface Waiter { grant: () => void }

export function createSemaphore({ maxActive, maxQueued, maxWaitMs }: SemaphoreOptions): Semaphore {
  let active = 0;
  const queue: Waiter[] = [];

  function releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) next.grant(); // the permit passes directly to the next waiter
      else active--;
    };
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(new AdmissionRefused("ABORTED"));
      if (active < maxActive) { active++; return Promise.resolve(releaser()); }
      if (queue.length >= maxQueued) return Promise.reject(new AdmissionRefused("QUEUE_FULL"));
      return new Promise((resolve, reject) => {
        const leave = (reason: AdmissionRefusalReason) => {
          const i = queue.indexOf(waiter);
          if (i !== -1) queue.splice(i, 1);
          cleanup();
          reject(new AdmissionRefused(reason));
        };
        const onAbort = () => leave("ABORTED");
        const timer = setTimeout(() => leave("TIMEOUT"), maxWaitMs);
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
        const waiter: Waiter = { grant: () => { cleanup(); resolve(releaser()); } };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(waiter);
      });
    },
    stats: () => ({ active, queued: queue.length }),
  };
}
