/**
 * components/local/form.ts: the machine as an address. Run with `npm run test:fit`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FORM, formFromQuery, formToQuery, type Form } from "../components/local/form.ts";

const GPU: Form = { kind: "discrete", preset: "custom", memory: "12", ram: "32", bandwidth: "360", context: "32768" };

test("the default machine keeps the plain address plain", () => {
  assert.equal(formToQuery(DEFAULT_FORM), "");
  // A preset label alone does not make it a different machine.
  assert.equal(formToQuery({ ...DEFAULT_FORM, preset: "something" }), "");
});

test("a machine round-trips through its address", () => {
  const query = formToQuery(GPU);
  assert.equal(new URLSearchParams(query).get("hw"), "discrete,12,32,360,32768");
  assert.deepEqual(formFromQuery(new URLSearchParams(query).get("hw")), GPU);
  const unified: Form = { kind: "unified", preset: "custom", memory: "24", ram: "", bandwidth: "", context: "8192" };
  assert.deepEqual(formFromQuery(new URLSearchParams(formToQuery(unified)).get("hw")), unified);
  // Decimals with either separator, as the form accepts them.
  assert.equal(formFromQuery("cpu,,7.5,,4096")?.ram, "7.5");
  assert.equal(formFromQuery("cpu,,7,5,,4096"), null);
});

test("anything that is not exactly what is written is ignored", () => {
  for (const bad of [null, "", "cpu", "cpu,,16,,8192,extra", "gpu,12,32,,8192", "cpu,,16,,9999",
    "cpu,,<script>,,8192", "cpu,,99999999,,8192", "cpu,,-4,,8192", "cpu,,1e3,,8192"]) {
    assert.equal(formFromQuery(bad), null, String(bad));
  }
});
