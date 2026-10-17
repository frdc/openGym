package com.fredc.opengym;
/** A past sensor choice only applies to the same verified active workout. */
final class WearHeartResume {
    static boolean allowed(String remembered,String current,boolean active,boolean permission,boolean verified) {
        return remembered != null && !remembered.isEmpty() && remembered.equals(current) && active && permission && verified;
    }
}
