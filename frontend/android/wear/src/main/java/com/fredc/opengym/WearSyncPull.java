package com.fredc.opengym;

/** A pull is a bounded challenge; neither an old callback nor a broadcast can
 * replace the challenge currently waiting for its corresponding phone reply. */
final class WearSyncPull {
    private String id="";
    private long deadline;
    synchronized boolean request(String next,long now) {
        if(next==null || next.isEmpty() || next.length()>100 || !id.isEmpty() && now<deadline) return false;
        id=next;deadline=now+5000;return true;
    }
    synchronized boolean matches(String candidate) {return !id.isEmpty() && id.equals(candidate);}
    synchronized boolean finish(String candidate) {if(!matches(candidate)) return false;id="";return true;}
    synchronized void reset() {id="";deadline=0;}
}
