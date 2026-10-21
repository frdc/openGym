package com.fredc.opengym;

final class WearBridgeGuard {
    static boolean currentOpenRequest(String currentContext, long currentRevision, boolean active, String requestContext, long requestRevision) {
        return active && currentContext != null && !currentContext.isEmpty() && currentContext.equals(requestContext) && currentRevision == requestRevision;
    }
    static boolean acknowledged(String acknowledgedKey, String token, long endsAt) {
        return token != null && !token.isEmpty() && endsAt > 0 && (token + ":" + endsAt).equals(acknowledgedKey);
    }
    static boolean allowed(String path, int size) {
        int limit = "/opengym/v1/command".equals(path) ? 65536 : 16384;
        return size > 0 && size <= limit && ("/opengym/v1/command".equals(path) || "/opengym/v1/sync".equals(path) || "/opengym/v1/heart".equals(path) || "/opengym/v1/refresh-result".equals(path));
    }
}
