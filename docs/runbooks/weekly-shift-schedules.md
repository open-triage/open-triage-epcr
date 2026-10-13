# Weekly shift schedules

Admin → Shift schedules authors named schedules shared within a root agency group.
Admin → Units → Schedule selects a schedule for an agency-owned unit and previews
its next handover in that agency's current IANA time zone. No selection is incomplete
setup. A selected schedule with zero breakpoints is deliberate blank setup.
There is no automatic template. Empty weekdays continue the preceding shift.
The group directory supports at most 500 named schedules. Creation enforces this
cap under a group lock; existing schedules remain readable and editable at capacity.

## Deterministic boundaries

- ISO weekdays use Monday=1 through Sunday=7. Breakpoints use minute precision,
  local `HH:mm`. Duplicate weekday/time values are rejected. There are at most
  168 breakpoints; grace is an integer from 0 through 1440 minutes inclusive.
- The server reads PostgreSQL's clock, evaluates and persists its preview. The
  browser formats those instants in the owning agency's zone, never evaluates
  a browser clock or supplies a time zone. Preview snapshots are derived data;
  they do not authenticate a user or authorize a new job.
- A daylight-saving fold chooses the first occurrence and produces one checkpoint.
  A gap advances by the size of the clock change, preserving the requested minute
  (Stockholm 02:30 becomes 03:30). The same rule handles date-line gaps.
- If gap normalization makes two events coincide, retain the shortest grace.
  Overlapping grace windows remain separate. A future new-job decision must check
  each checkpoint's own authentication threshold; an early window does not
  replace the active shift's requirement. Grace is elapsed time before the event.
- Exact checkpoint instants activate the incoming shift. Grace begins inclusively
  and ends at its checkpoint; zero grace has no early window.

## Immutable and prospective changes

Every schedule revision and unit selection is an immutable audit record with its
actor and effective server instant. Initial authoring and first selection exclude
all prior occurrences, so a current shift is never retroactively invented.
A schedule edit becomes effective at the latest next existing checkpoint among
currently selected agency zones (the author's zone if no units select it). Until
then, the prior version supplies future events. A second edit while a version is
pending is rejected rather than overwriting history.

At activation, events belonging to the old version before the boundary continue
supplying the active shift until the new version actually produces a checkpoint.
A transition to a blank version deliberately stops scheduled handover checks at
the effective boundary. Selecting another schedule, removing selection or choosing
blank takes effect at that unit's next existing checkpoint, preserving the current
shift until then. From blank or missing setup it takes effect immediately. The
unit's previous active checkpoint is retained as fallback until the replacement
schedule produces its first prospective checkpoint.

Agency time-zone edits become effective at the next authoritative server evaluation.
The previous active checkpoint is retained, while only future occurrences in the
new zone are eligible. The projection persists this zone context and its start
instant so later refreshes cannot invent a retrospective checkpoint. New-job
access must reevaluate rather than trust a stored preview. Session expiry,
revocation, device enrollment and permissions remain independent.
