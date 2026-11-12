package org.opentriage.development;

/** Test-only historical fixture selection, never a runtime capability bypass. */
final class HistoricalUpgradePreparation {
    static boolean enabled(String profile,String packageName,long versionCode,String phase,boolean upgrade) {
        if ("current".equals(profile)) return false;
        if (!"historical-a1-camera-v1".equals(profile) || !"org.opentriage.android".equals(packageName)
                || versionCode!=1 || !"prepare".equals(phase) || !upgrade) {
            throw new IllegalArgumentException("Historical preparation requires the verified production A1 upgrade preparation");
        }
        return true;
    }
}
