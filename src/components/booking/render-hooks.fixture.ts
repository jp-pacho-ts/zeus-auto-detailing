// Test helper: renders a client component function with a minimal hook dispatcher (state, refs,
// memo/callback, effects) so tests can call its real event handlers, including twice from the same
// render as a rapid double tap does. Child components are not expanded; their props are reachable.
import * as React from "react";

type Deps = readonly unknown[] | undefined;
type Node = React.ReactNode;
// The props tests reach for; others stay unknown.
type Props = Record<string, unknown> & {
  children: Node;
  disabled: boolean;
  id: string;
  onClick: () => void;
  onChange: (event: unknown) => void;
  onSubmit: (event: unknown) => void;
  onCancel: () => void;
  onChangeDay: () => void;
  onSelect: (date: string) => void;
};
type Element = React.ReactElement<Props>;

const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown } })
  .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const same = (a: Deps, b: Deps) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export function mountHooks<P>(component: (props: P) => Node, initialProps: P) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const memos: { deps: Deps; value: unknown }[] = [];
  const effects: { deps: Deps; cleanup: unknown }[] = [];
  let props = initialProps;
  let tree: Node = null;
  let dirty = false;

  function render() {
    let s = 0, r = 0, m = 0, e = 0;
    const queued: (() => void)[] = [];
    const dispatcher = {
      useState(init: unknown) {
        const i = s++;
        if (!(i in states)) states[i] = typeof init === "function" ? (init as () => unknown)() : init;
        const set = (v: unknown) => {
          const next = typeof v === "function" ? (v as (p: unknown) => unknown)(states[i]) : v;
          if (!Object.is(next, states[i])) {
            states[i] = next;
            dirty = true;
          }
        };
        return [states[i], set];
      },
      useRef(init: unknown) {
        const i = r++;
        if (!refs[i]) refs[i] = { current: init };
        return refs[i];
      },
      useMemo(fn: () => unknown, deps: Deps) {
        const i = m++;
        if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: fn() };
        return memos[i].value;
      },
      useCallback(fn: unknown, deps: Deps) {
        const i = m++;
        if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: fn };
        return memos[i].value;
      },
      useEffect(fn: () => unknown, deps: Deps) {
        const i = e++;
        const previous = effects[i];
        if (!previous || !same(previous.deps, deps))
          queued.push(() => {
            if (typeof previous?.cleanup === "function") (previous.cleanup as () => void)();
            effects[i] = { deps, cleanup: fn() };
          });
      },
    };
    const saved = internals.H;
    internals.H = dispatcher;
    try {
      dirty = false;
      tree = component(props);
    } finally {
      internals.H = saved;
    }
    for (const run of queued) run();
  }

  // Re-render while state changed, letting promises and timers of the component settle in between.
  async function settle(rounds = 30) {
    for (let k = 0; k < rounds; k++) {
      while (dirty) render();
      await new Promise((resolve) => setImmediate(resolve));
    }
    while (dirty) render();
  }

  const elements = (node: Node): Element[] => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!React.isValidElement(node)) return [];
    const el = node as Element;
    return [el, ...elements(el.props.children as Node)];
  };
  const textOf = (node: Node): string =>
    typeof node === "string" || typeof node === "number"
      ? String(node)
      : Array.isArray(node)
        ? node.map(textOf).join("")
        : React.isValidElement(node)
          ? textOf((node as Element).props.children as Node)
          : "";

  render();
  return {
    settle,
    rerender(next: P) {
      props = next;
      render();
    },
    all: () => elements(tree),
    text: () => textOf(tree),
    // A host button by its visible text (exact, trimmed).
    button(label: string) {
      return elements(tree).find((el) => el.type === "button" && textOf(el.props.children as Node).trim() === label) ?? null;
    },
    // An element rendered from a child component, to reach its callback props.
    child(type: unknown) {
      return elements(tree).find((el) => el.type === type) ?? null;
    },
    unmount() {
      for (const effect of effects) if (typeof effect?.cleanup === "function") (effect.cleanup as () => void)();
    },
  };
}

// A promise whose resolution the test controls.
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
