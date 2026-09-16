# Authorized feedback implementation cycle

Use this workflow only after the user explicitly authorizes addressing an item.
Keep the change scoped to that item and preserve unrelated working-tree changes.

1. Re-read the latest item and relevant evidence before editing.
2. Implement the bounded fix and run automated checks proportionate to the
   behavior.
3. Start the standard local database-backed app with:

   ```sh
   npm run feedback:validate -- start
   ```

   The helper reuses compatible services on ports 3000 and 3001, starts only
   missing services using the repository's prescribed commands, refuses unknown
   port occupants, and records only processes it owns. Use `status` to inspect
   it and `stop` after validation. Do not manually terminate unrelated or reused
   processes.
4. Confirm API health and the relevant browser path, then tell the user the web
   and API URLs, exact workflow/viewport to validate, automated checks that
   passed, and that the change is not committed or resolved yet.
5. Keep the app available and pause for human validation. Screenshots,
   automation, and the agent's own inspection are not human approval. If the
   user reports a problem, revise the fix, rerun checks, and hand it off again.

An explicit positive response to that validation hand-off authorizes this
completion sequence for the validated item:

1. Recheck the working tree and commit only that item's implementation and
   tests. Use a concise message without credentials or sensitive feedback data.
2. Re-read the feedback item and latest review version. Dry-run, then apply, a
   `resolved` decision through the same instance context wrapper. Preserve or
   set an evidence-based priority and add a concise note with human validation
   and commit identifier. Do not resolve if the commit failed, the version is
   stale, or committed code differs from validated code.
3. Verify the recorded decision. Run `npm run feedback:validate -- stop` when
   local validation is no longer needed; it must leave reused processes alone.

Proceed to another item only if the user authorized addressing the queue or
multiple items. Otherwise report completion and stop. For each next item, repeat
the read, implement, automated test, human validation, commit, and resolution
gates.
