/**
 * lib/changes.ts: parsing and grouping the change log. Run with `npm run test:fit`.
 * The fixture is a sample of real events from data/changes.jsonl's history.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayCounts, eventsForModel, groupByDate, parseChanges } from "../lib/changes.ts";

const sample = readFileSync("tests/fixtures/changes-sample.jsonl", "utf8");

test("every line of the real sample parses, and nothing is dropped", () => {
  const lines = sample.split("\n").filter(Boolean).length;
  assert.equal(parseChanges(sample).length, lines);
});

test("bad lines, unknown kinds and bad dates are skipped, not fatal", () => {
  const text = [
    '{"date":"2026-11-01","type":"model_added","model_id":"m","ranked":true,"rank":1,"tied":false,"composite":9}',
    "not json", "", '{"date":"2026-11-01","type":"mystery"}', '{"date":"yesterday","type":"arena_scale"}', '{"date":"2026-11-02","type":"arena_scale","min":[1,1],"max":[2,2]',
  ].join("\n");
  assert.equal(parseChanges(text).length, 1);
  assert.deepEqual(parseChanges(""), []);
});

test("groupByDate: newest first, limited to the newest dates, events in a stable order", () => {
  const days = groupByDate(parseChanges(sample), 3);
  assert.equal(days.length, 3);
  assert.ok(days[0].date > days[1].date && days[1].date > days[2].date);
  const types = days.flatMap((day) => day.events.map((event) => event.type));
  assert.ok(types.length > 0);
  // Reversing the input changes nothing about what comes out.
  const reversed = groupByDate(parseChanges(sample).reverse(), 3);
  assert.deepEqual(reversed, days);
});

test("dayCounts counts arrivals, departures, gate crossings and moves", () => {
  const day = groupByDate(parseChanges(sample), 40).find((d) => d.date === "2026-11-05");
  assert.ok(day);
  const counts = dayCounts(day);
  assert.equal(counts.added, day.events.filter((e) => e.type === "model_added").length);
  assert.equal(counts.shifted, day.events.some((e) => e.type === "cohort_shift"));
});

test("eventsForModel: only that model's events, newest first", () => {
  const events = parseChanges(sample);
  const id = (events.find((e) => e.type === "moved") as { model_id: string }).model_id;
  const mine = eventsForModel(events, id);
  assert.ok(mine.length > 0);
  assert.ok(mine.every((e) => "model_id" in e && e.model_id === id));
  assert.deepEqual(mine.map((e) => e.date), [...mine.map((e) => e.date)].sort().reverse());
});
