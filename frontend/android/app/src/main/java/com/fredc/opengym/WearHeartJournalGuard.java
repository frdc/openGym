package com.fredc.opengym;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Private owner identifiers never enter wearable packets or exported training data. */
final class WearHeartJournalGuard {
    static String ownerKey(String owner) {
        if (owner == null || owner.isEmpty() || owner.length() > 512) return null;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(owner.getBytes(StandardCharsets.UTF_8));
            char[] hex = "0123456789abcdef".toCharArray(); StringBuilder result = new StringBuilder(64);
            for (byte b : digest) { result.append(hex[(b & 255) >>> 4]).append(hex[b & 15]); }
            return result.toString();
        }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    static boolean validJournal(int count, int bytes) { return count >= 0 && count <= 200 && bytes > 0 && bytes <= 524288; }
    static boolean validAck(String request, String token, String status) {
        return request != null && !request.isEmpty() && request.length() <= 100 && token != null && !token.isEmpty() && token.length() <= 100 && ("ok".equals(status) || "error".equals(status));
    }
}
