import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewWorkloadLabel } from "../app/review-workload-label";
import { ReviewAnalysisChart } from "../components/review-analysis-chart";

test("D3 chart renders every result group including groups after the twentieth", () => {
  const values = Array.from({ length: 21 }, (_, index) => ({ value: `Group ${index + 1}`, count: index + 1 }));
  const markup = renderToStaticMarkup(createElement(ReviewAnalysisChart, { title: "All groups", values }));
  assert.equal((markup.match(/<rect /g) ?? []).length, 21);
  assert.match(markup, /Group 21/);
  const height = Number(markup.match(/viewBox="0 0 720 (\d+)"/)?.[1]);
  assert.ok(height >= 21 * 32, "every row keeps readable label height");
  assert.match(markup, /font-size="14"/);
});

test("workload grouping labels are localized without changing raw group keys", () => {
  const cases = [
    ["age", "0-1 days", "0–1 dagar"],
    ["age", "31+ days", "31+ dagar"],
    ["completion-duration", "not completed", "Inte slutförd"],
    ["completion-duration", "under 1 hour", "Under 1 timme"],
    ["completion-duration", "over 7 days", "Över 7 dagar"],
    ["exception-reason", "no exception", "Inget undantag"],
    ["exception-reason", "duplicate-follow-up", "Dubbel uppföljning"],
    ["exception-reason", "report-not-required", "Journal krävs inte"],
    ["exception-reason", "administrative-exception", "Administrativt undantag"],
  ] as const;
  for (const [groupBy, key, label] of cases) {
    assert.equal(reviewWorkloadLabel("sv", groupBy, key), label);
  }
  assert.equal(reviewWorkloadLabel("en", "exception-reason", "duplicate-follow-up"), "Duplicate follow-up");
  assert.equal(reviewWorkloadLabel("sv", "criterion", "custom-criterion"), "custom-criterion");
});
