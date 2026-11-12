package org.opentriage.development;

import android.content.Context;
import java.io.File;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.function.BooleanSupplier;

/** Memory-only authority; opaque private files cannot be recovered or shared after process death. */
final class NativePdfSessions {
    interface Loader { byte[] load() throws Exception; }
    interface Refresher { void check() throws Exception; }
    static final class Revoked extends Exception {}
    static final class Session implements AutoCloseable {
        final String id;
        final Object owner;
        private final File directory;
        private final Loader loader;
        private final BooleanSupplier authority;
        private final NativePdfLifetime lifetime;
        private File preview;
        private volatile boolean closed;
        private final java.util.concurrent.atomic.AtomicBoolean refreshing = new java.util.concurrent.atomic.AtomicBoolean();
        volatile Refresher refresher = () -> {};
        volatile Runnable onClosed = () -> {};
        Session(Object owner, String id, File directory, long expiry, BooleanSupplier authority, Loader loader) {
            this(owner,id,directory,expiry,authority,loader,System::currentTimeMillis,android.os.SystemClock::elapsedRealtime);
        }
        Session(Object owner, String id, File directory, long expiry, BooleanSupplier authority, Loader loader, java.util.function.LongSupplier clock) {
            this(owner,id,directory,expiry,authority,loader,clock,clock);
        }
        Session(Object owner, String id, File directory, long expiry, BooleanSupplier authority, Loader loader, java.util.function.LongSupplier wall, java.util.function.LongSupplier elapsed) {
            this(owner,id,directory,new NativePdfLifetime(wall.getAsLong(),elapsed.getAsLong(),expiry-wall.getAsLong(),wall,elapsed),authority,loader);
        }
        Session(Object owner, String id, File directory, NativePdfLifetime lifetime, BooleanSupplier authority, Loader loader) {
            this.owner = owner; this.id = id; this.directory = directory; this.lifetime = lifetime;
            this.authority = authority; this.loader = loader;
        }
        boolean current() { return !closed && lifetime.current() && authority.getAsBoolean() && !closed; }
        void requireCurrent() { if (!current()) throw new IllegalStateException("PDF context ended"); }
        void reassess() {
            if (!current()) { close(); return; }
            if (!refreshing.compareAndSet(false,true)) return;
            try { requireCurrent(); refresher.check(); if (!current()) close(); }
            catch (Revoked denied) { close(); }
            catch (Exception unavailable) { if (!current()) close(); /* Connectivity cannot extend the original deadline. */ }
            finally { refreshing.set(false); }
        }
        byte[] fresh() throws Exception {
            requireCurrent();byte[] bytes=loader.load();
            try {requireCurrent();return bytes;}
            catch(Exception ended){if(bytes!=null)java.util.Arrays.fill(bytes,(byte)0);throw ended;}
        }
        File cache(byte[] bytes) throws Exception {
            try {
                requireCurrent();
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Private PDF storage unavailable");
                File next = new File(directory, id + ".pdf");
                synchronized (this) { requireCurrent(); preview = next; }
                try { Files.write(next.toPath(), bytes); requireCurrent(); return next; }
                catch (Exception error) { next.delete(); throw error; }
            } finally { java.util.Arrays.fill(bytes, (byte) 0); }
        }
        File preview() throws Exception {
            synchronized (this) { requireCurrent(); if (preview != null) return preview; }
            return cache(fresh());
        }
        synchronized void clearPreview() { if (preview != null) { preview.delete(); preview = null; } }
        @Override public void close() {
            synchronized (this) { if (closed) return; closed = true; clearPreview(); }
            synchronized (sessions) { sessions.remove(id, this); }
            onClosed.run();
        }
    }
    private static final Map<String, Session> sessions = new HashMap<>();
    private static final Map<String, Object> pending = new HashMap<>();
    static void begin(Object owner, String id) {
        if (id == null || !id.matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")) throw new IllegalArgumentException("Invalid PDF operation");
        synchronized (sessions) {
            if (pending.size() + sessions.size() >= 4 || pending.containsKey(id) || sessions.containsKey(id)) throw new IllegalStateException("PDF operation in progress");
            pending.put(id, owner);
        }
    }
    static boolean pending(Object owner, String id) { synchronized (sessions) { return pending.get(id) == owner; } }
    static boolean alive(Object owner, String id) { synchronized (sessions) { Session session = sessions.get(id); return pending.get(id) == owner || session != null && session.owner == owner && !session.closed; } }
    static Session create(Context context, Object owner, String id, long expiry, BooleanSupplier current, Loader loader) {
        return create(context,owner,id,new NativePdfLifetime(System.currentTimeMillis(),android.os.SystemClock.elapsedRealtime(),expiry-System.currentTimeMillis(),System::currentTimeMillis,android.os.SystemClock::elapsedRealtime),current,loader);
    }
    static Session create(Context context, Object owner, String id, NativePdfLifetime lifetime, BooleanSupplier current, Loader loader) {
        synchronized (sessions) {
            if (pending.get(id) != owner) throw new IllegalStateException("PDF operation cancelled");
            pending.remove(id);
            Session session = new Session(owner, id, directory(context), lifetime, current, loader); sessions.put(id, session); return session;
        }
    }
    static Session get(String id) { synchronized (sessions) { return sessions.get(id); } }
    static void close(Object owner, String id) {
        Session session;
        synchronized (sessions) { pending.remove(id, owner); session = sessions.get(id); }
        if (session != null && session.owner == owner) session.close();
    }
    static void closeOwner(Object owner) {
        java.util.List<Session> copy;
        synchronized (sessions) { pending.entrySet().removeIf(entry -> entry.getValue() == owner); copy = new java.util.ArrayList<>(sessions.values()); }
        for (Session session : copy) if (session.owner == owner) session.close();
    }
    static File directory(Context context) { return new File(context.getNoBackupFilesDir(), "pdf-preview"); }
    static void cleanOrphans(Context context) {
        java.util.List<Session> copy;
        synchronized (sessions) { copy = new java.util.ArrayList<>(sessions.values()); pending.clear(); }
        for (Session session : copy) session.close();
        File[] files = directory(context).listFiles();
        if (files != null) for (File file : files) if (file.isFile() && file.getName().matches("[a-f0-9-]{36}\\.pdf")) file.delete();
    }
}
