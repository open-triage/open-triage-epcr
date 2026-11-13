package org.opentriage.development;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

/** Read and serialize encrypted rows in one document; navigation restarts an unfinished read. */
final class AndroidEncryptedSnapshot {
    @FunctionalInterface interface Evaluate { String run(String script) throws Exception; }
    static String read(Evaluate evaluate, String variable) throws Exception { return read(evaluate, variable, 60_000); }
    static String read(Evaluate evaluate, String variable, long timeoutMillis) throws Exception {
        if (!variable.matches("__[A-Za-z0-9_]+") || timeoutMillis <= 0) throw new IllegalArgumentException("Invalid snapshot request");
        String token = UUID.randomUUID().toString();
        String script = "(()=>{const key='" + variable + "',token='" + token + "';"
            + "const reads=window.__openTriageSnapshotReads??={};if(reads[key]!==token){reads[key]=token;window[key]=null;"
            + "const realm=window.document;const store=rows=>{if(window.document===realm&&window.__openTriageSnapshotReads?.[key]===token)window[key]=rows;};"
            + "const request=indexedDB.open('open-triage-protected-clinical-v1');request.onupgradeneeded=()=>{request.transaction.abort();store([]);};"
            + "request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('encrypted-reports')){store([]);db.close();return;}"
            + "const query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();"
            + "query.onsuccess=()=>{store(query.result.map(row=>({...row,ciphertext:Array.from(new Uint8Array(row.ciphertext)),nonce:Array.from(new Uint8Array(row.nonce))})));db.close();};query.onerror=()=>db.close();};}"
            + "return Array.isArray(window[key])?JSON.stringify(window[key]):null;})()";
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000;
        do {
            String value = evaluate.run(script);
            if (completed(value)) return value;
            Thread.sleep(Math.min(100, timeoutMillis));
        } while (System.nanoTime() < deadline);
        throw new AssertionError("Encrypted snapshot did not complete across document navigation: " + variable);
    }
    private static boolean completed(String value) { return value != null && value.startsWith("\"[") && value.endsWith("]\""); }
    static String digest(String encodedSnapshot) throws Exception {
        if (!completed(encodedSnapshot)) throw new AssertionError("Only a completed encrypted array snapshot can be hashed");
        var hash = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(encodedSnapshot.getBytes(StandardCharsets.UTF_8))) hash.append(String.format(Locale.ROOT, "%02x", value & 255));
        return hash.toString();
    }
}
