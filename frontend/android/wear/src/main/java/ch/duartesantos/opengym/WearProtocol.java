package ch.duartesantos.opengym;

final class WearProtocol {
    static boolean canOpen(int version, String id, long sentAt, long now, boolean active) {
        return version == 1 && id != null && !id.isEmpty() && id.length() <= 100 && active && sentAt > 0 && now - sentAt >= -5000 && now - sentAt <= 30000;
    }
    static boolean shouldArm(String key, String oldKey, String firedKey, boolean armed) {
        return !key.equals(firedKey) && (!key.equals(oldKey) || !armed);
    }
    static boolean acceptRevision(String oldContext, long oldRevision, String context, long revision) {
        return !oldContext.equals(context) || revision >= oldRevision;
    }
    static boolean canControl(boolean connected, long confirmedAt, long now, boolean pending) {
        return connected && confirmedAt > 0 && now - confirmedAt < 12000 && !pending;
    }
    static boolean shouldFire(String incoming, String current, String fired, long endsAt, long now) {
        return !incoming.isEmpty() && incoming.equals(current) && !incoming.equals(fired) && endsAt > 0 && now >= endsAt;
    }
}
