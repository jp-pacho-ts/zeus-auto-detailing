// Sign out asks first: only the confirm button ends the session; Stay signed in and Escape keep it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Button } from "@/components/ui/button";
import { mountHooks } from "../booking/render-hooks.fixture";
import { SignOutDialog } from "./sign-out-dialog";

function mount(open: boolean) {
  const calls: string[] = [];
  const h = mountHooks(SignOutDialog, { open, onCancel: () => calls.push("cancel"), onConfirm: () => calls.push("confirm") });
  const button = (label: string) => h.all().find((el) => el.type === Button && el.props.children === label) ?? null;
  return { h, calls, button };
}

test("closed: no confirmation is shown", () => {
  const { button } = mount(false);
  assert.equal(button("Sign out"), null);
});

test("open: Sign out confirms, Stay signed in cancels", () => {
  const { h, calls, button } = mount(true);
  assert.match(h.text(), /Sign out\?/);
  button("Stay signed in")!.props.onClick();
  assert.deepEqual(calls, ["cancel"]);
  button("Sign out")!.props.onClick();
  assert.deepEqual(calls, ["cancel", "confirm"]);
});

test("open: Escape cancels without signing out", () => {
  const { h, calls } = mount(true);
  let prevented = false;
  const dialog = h.all().find((el) => el.props.role === "alertdialog")!;
  (dialog.props.onCancel as unknown as (e: { preventDefault(): void }) => void)({ preventDefault: () => (prevented = true) });
  assert.ok(prevented, "the native close is replaced by the exit animation");
  assert.deepEqual(calls, ["cancel"]);
});
