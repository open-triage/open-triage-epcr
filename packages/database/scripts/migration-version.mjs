function timestamp(date) {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

// Follow the whole migration timeline, including multiple generations in one
// second or a developer clock behind a migration already committed by a peer.
export function nextMigrationVersion(filenames, now = new Date()) {
  const latest = filenames
    .map((name) => /^(\d+)_.*\.sql$/.exec(name)?.[1])
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest || timestamp(now) > latest) return timestamp(now);

  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(latest);
  if (!match) throw new Error(`Cannot generate after invalid migration timestamp: ${latest}`);
  const [, year, month, day, hour, minute, second] = match;
  const previous = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (!Number.isFinite(previous.getTime()) || timestamp(previous) !== latest) {
    throw new Error(`Cannot generate after invalid migration timestamp: ${latest}`);
  }
  return timestamp(new Date(previous.getTime() + 1000));
}
