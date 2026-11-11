package org.opentriage.development;

/** A lifecycle refresh is not a policy change and must not invalidate a committed enrollment. */
final class ManagedPolicyRevision {
    private String identity;
    private long generation;
    synchronized void observe(ManagedConnectionPolicy.State state) {
        String next = state.status() + ":" + state.context();
        if (identity != null && !identity.equals(next)) generation++;
        identity = next;
    }
    synchronized long current() { return generation; }
}
