-- Existing decisions and immutable source evidence remain unchanged.
alter table clinical.eps_import drop constraint eps_import_decision_check;
alter table clinical.eps_import add constraint eps_import_decision_check check (decision in ('import','keep','replace','append'));
