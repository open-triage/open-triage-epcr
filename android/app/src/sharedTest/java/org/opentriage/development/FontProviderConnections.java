package org.opentriage.development;

/** Test-only ActivityManager evidence parser shared by JVM and device tests. */
final class FontProviderConnections {
    record Evidence(boolean bound, int providerCount, String records) {}
    static Evidence inspect(String dump, int pid, String applicationId) {
        if (!dump.contains("ACTIVITY MANAGER CONTENT PROVIDERS") || dump.length() >= 262144 || pid < 1)
            throw new IllegalArgumentException("Incomplete ActivityManager provider evidence");
        // Android13's plural providers command ignores a component argument.
        // Only a connection INSIDE the exact provider record is evidence.
        // AOSP: ContentProviderHelper.dumpProvidersLocked, ProviderMap,
        // ContentProviderRecord.dump and ContentProviderConnection.toClientString.
        boolean font = false, bound = false; int count = 0;
        StringBuilder records = new StringBuilder();
        for (String line : dump.split("\\n")) {
            if (line.startsWith("  * ContentProviderRecord{")) {
                font = line.endsWith(" com.google.android.gms/.fonts.provider.FontsProvider}");
                if (font) count++;
            } else if (line.startsWith("  ") && !line.startsWith("    ") && !line.isBlank()) font = false;
            if (font) {
                records.append(line).append('\n');
                if (line.trim().startsWith("-> " + pid + ":" + applicationId + "/")) bound = true;
            }
        }
        return new Evidence(bound, count, records.length() == 0 ? "(not published)" : records.toString());
    }
}
