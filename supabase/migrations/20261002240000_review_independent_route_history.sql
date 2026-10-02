-- Preserve the independent-review setting alongside each versioned routing decision.
alter table clinical.review_criterion_route_history
  add column independent_review boolean not null default false;
