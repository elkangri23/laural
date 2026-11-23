import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_JAVASCRIPT_BUNDLE_BYTES, oversizedBundles } from "./check-bundle-size.mjs";

describe("límite de tamaño de bundles", () => {
  it("acepta bundles en el máximo de 500 KiB", () => {
    assert.deepEqual(oversizedBundles([{ name: "app.js", bytes: MAX_JAVASCRIPT_BUNDLE_BYTES }]), []);
  });

  it("rechaza cada bundle que supera el máximo", () => {
    const bundles = [
      { name: "app.js", bytes: MAX_JAVASCRIPT_BUNDLE_BYTES },
      { name: "terminal.js", bytes: MAX_JAVASCRIPT_BUNDLE_BYTES + 1 },
    ];

    assert.deepEqual(oversizedBundles(bundles), [bundles[1]]);
  });
});
