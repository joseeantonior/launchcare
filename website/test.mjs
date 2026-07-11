// node website/test.mjs — fails loudly if lib logic breaks.
import assert from "node:assert/strict";
import { maskEmail, buildTree, fmtUsd } from "./lib.mjs";

// maskEmail
assert.equal(maskEmail("contact sam.t@gmail.com asap"), "contact s***@gmail.com asap");
assert.equal(maskEmail("two: a@b.co and maya.r@gmail.com"), "two: a***@b.co and m***@gmail.com");
assert.equal(maskEmail("no email here"), "no email here");
assert.equal(maskEmail(null), null);

// buildTree: root -> child -> grandchild, plus orphan becomes root; sorted by startedAt
const steps = [
  { _id: "c", parentStepId: "a", startedAt: 2 },
  { _id: "a", parentStepId: undefined, startedAt: 1 },
  { _id: "d", parentStepId: "c", startedAt: 3 },
  { _id: "orphan", parentStepId: "missing", startedAt: 0 },
  { _id: "b", parentStepId: "a", startedAt: 5 },
];
const roots = buildTree(steps);
assert.deepEqual(roots.map((r) => r._id), ["orphan", "a"]);
assert.deepEqual(roots[1].children.map((c) => c._id), ["c", "b"]);
assert.deepEqual(roots[1].children[0].children.map((c) => c._id), ["d"]);

// fmtUsd
assert.equal(fmtUsd(1.5), "$1.5");
assert.equal(fmtUsd(0.0042), "$0.0042");
assert.equal(fmtUsd(0), "$0");
assert.equal(fmtUsd(undefined), "$0");

console.log("website/test.mjs: all assertions passed");
