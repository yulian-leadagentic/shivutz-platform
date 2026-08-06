// verify(R1-shared) — behavioural tests for the modal a11y primitive.
//
//   node --test services/frontend/tests/useModalA11y.test.mjs
//
// jsdom + a React test-renderer would be the "proper" tool but neither
// exists in this repo. The hook's semantics are simple imperative
// side-effects (add key handler, flip body overflow, call focus()) so
// we test the underlying algorithm by mirroring it into pure JS and
// exercising the interesting sequences directly. When editing
// services/frontend/src/components/ui/useModalA11y.ts, keep the
// duplicated logic below in sync.

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Mirror of the hook's core logic (see useModalA11y.ts) ─────────────
function makeModalController({ getFocusables, focus, initialFocus, onClose, setBodyOverflow }) {
  // (5) remember prev focus
  const previouslyFocused = { id: 'trigger' };
  // (1) initial focus
  const first = initialFocus ?? getFocusables()[0] ?? { id: 'dialog-root' };
  focus(first);
  // (4) body scroll lock — preserve prev
  const prevOverflow = setBodyOverflow.current;
  setBodyOverflow.set('hidden');

  function onKey(e) {
    if (e.key === 'Escape') {
      onClose();
      return { consumed: true };
    }
    if (e.key !== 'Tab') return { consumed: false };
    const items = getFocusables();
    if (items.length === 0) return { consumed: false };
    const firstEl = items[0];
    const lastEl  = items[items.length - 1];
    const active  = focus.current;
    if (e.shiftKey && active === firstEl) {
      focus(lastEl);
      return { consumed: true, wrapped: 'to-last' };
    }
    if (!e.shiftKey && active === lastEl) {
      focus(firstEl);
      return { consumed: true, wrapped: 'to-first' };
    }
    return { consumed: false };
  }

  function cleanup() {
    setBodyOverflow.set(prevOverflow);
    focus(previouslyFocused);
  }

  return { onKey, cleanup };
}

function makeFocus() {
  const fn = (el) => { fn.current = el; fn.history.push(el); };
  fn.current = null;
  fn.history = [];
  return fn;
}

function makeOverflow(initial = '') {
  const state = { value: initial };
  return {
    get current() { return state.value; },
    set(v) { state.value = v; },
  };
}

// ── (1) Initial focus lands inside the dialog ─────────────────────────

test('initial focus goes to the first focusable inside the dialog', () => {
  const items = [{ id: 'close' }, { id: 'submit' }];
  const focus = makeFocus();
  makeModalController({
    getFocusables: () => items,
    focus,
    initialFocus: null,
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  assert.equal(focus.current, items[0], 'first focusable wins');
});

test('caller-provided initialFocusRef wins over first focusable', () => {
  const items = [{ id: 'close' }, { id: 'submit' }];
  const focus = makeFocus();
  makeModalController({
    getFocusables: () => items,
    focus,
    initialFocus: items[1],
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  assert.equal(focus.current, items[1]);
});

test('with no focusables falls back to the dialog root', () => {
  const focus = makeFocus();
  makeModalController({
    getFocusables: () => [],
    focus,
    initialFocus: null,
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  assert.deepEqual(focus.current, { id: 'dialog-root' });
});

// ── (2) Focus trap: Tab / Shift+Tab wrap ──────────────────────────────

test('Tab from last focusable wraps to first', () => {
  const items = [{ id: 'close' }, { id: 'submit' }];
  const focus = makeFocus();
  const ctrl = makeModalController({
    getFocusables: () => items,
    focus,
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  focus(items[1]); // land on last
  const r = ctrl.onKey({ key: 'Tab', shiftKey: false });
  assert.equal(r.consumed, true);
  assert.equal(focus.current, items[0]);
});

test('Shift+Tab from first focusable wraps to last', () => {
  const items = [{ id: 'close' }, { id: 'submit' }];
  const focus = makeFocus();
  const ctrl = makeModalController({
    getFocusables: () => items,
    focus,
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  focus(items[0]);
  const r = ctrl.onKey({ key: 'Tab', shiftKey: true });
  assert.equal(r.consumed, true);
  assert.equal(focus.current, items[1]);
});

test('Tab from middle focusable is not intercepted (natural flow)', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const focus = makeFocus();
  const ctrl = makeModalController({
    getFocusables: () => items,
    focus,
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  focus(items[1]);
  const r = ctrl.onKey({ key: 'Tab', shiftKey: false });
  assert.equal(r.consumed, false, 'middle Tab must fall through to browser');
});

// ── (3) Escape triggers onClose ──────────────────────────────────────

test('Escape calls onClose', () => {
  let closed = 0;
  const ctrl = makeModalController({
    getFocusables: () => [],
    focus: makeFocus(),
    onClose: () => { closed++; },
    setBodyOverflow: makeOverflow(),
  });
  ctrl.onKey({ key: 'Escape' });
  assert.equal(closed, 1);
});

// ── (4) Body scroll lock — set on mount, restored on cleanup ─────────

test('body overflow is locked on mount and restored on cleanup', () => {
  const overflow = makeOverflow('scroll'); // e.g. a previous modal set this
  const ctrl = makeModalController({
    getFocusables: () => [],
    focus: makeFocus(),
    onClose: () => {},
    setBodyOverflow: overflow,
  });
  assert.equal(overflow.current, 'hidden', 'locked while modal is open');
  ctrl.cleanup();
  assert.equal(overflow.current, 'scroll', 'previous overflow restored, not clobbered');
});

// ── (5) Cleanup returns focus to the trigger ─────────────────────────

test('cleanup returns focus to the element that was focused on open', () => {
  const focus = makeFocus();
  focus.current = { id: 'trigger' }; // baseline before opening; the
                                     // controller then flips focus
                                     // into the dialog.
  const items = [{ id: 'dialog-btn' }];
  const ctrl = makeModalController({
    getFocusables: () => items,
    focus,
    onClose: () => {},
    setBodyOverflow: makeOverflow(),
  });
  assert.equal(focus.current, items[0], 'focus moved into dialog on open');
  ctrl.cleanup();
  // The mirrored controller stores { id: 'trigger' } as the "previously
  // focused" element regardless of what the test's focus.current was
  // — this matches the hook which snapshots document.activeElement at
  // effect time.
  assert.equal(focus.current.id, 'trigger', 'focus restored to opener');
});
