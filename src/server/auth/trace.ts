import "server-only";

// Test-only resource trace (D-01 case 4): records permit, hashing-slot and floor-timer
// transitions so tests can check their order. A no-op unless a test installs a recorder.
let recorder: ((event: string) => void) | null = null;

export function trace(event: string): void {
  recorder?.(event);
}

export function setTraceRecorder(next: ((event: string) => void) | null): void {
  recorder = next;
}
