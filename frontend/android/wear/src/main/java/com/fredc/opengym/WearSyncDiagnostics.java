package com.fredc.opengym;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.SystemClock;
import android.util.Log;
import org.json.JSONObject;
import java.util.Set;

/** Fixed codes and counters in memory only. No payload, account, exercise, token,
 * node address or heart measurement is accepted by this diagnostic interface. */
final class WearSyncDiagnostics {
    static final WearSyncDiagnostics live=new WearSyncDiagnostics();
    private static final Set<String> STAGES=Set.of("discover","phone-found","sync-send","state","replay-send","ack","heart-ack","visible","open-request","open-notification","paused","other");
    private static final Set<String> ERRORS=Set.of("no-phone","multiple-phones","discovery-failed","send-failed","state-rejected","open-rejected","open-state-rejected","background-launch","baseline-conflict","state-conflict","field-conflict","target-conflict","stream-conflict","event-conflict","stale-context","stale-target","stale-unit","unsupported-set","unavailable","heart-rejected","other");
    private String stage="idle",error="none";
    private long lastState=-1,revision;
    private int requests,sent,received,ackSeq;
    synchronized void event(String next,String code,long now) {
        stage=STAGES.contains(next)?next:"other";
        if(code!=null && !code.isEmpty()) error=ERRORS.contains(code)?code:"other";
        if((code==null || code.isEmpty()) && "discover".equals(stage)) requests++;
        if((code==null || code.isEmpty()) && ("sync-send".equals(stage)||"replay-send".equals(stage))) sent++;
    }
    synchronized void received(long rev,long now) {received++;revision=rev;lastState=now;stage="state";}
    synchronized void ack(int seq,String code,long now) {ackSeq=Math.max(0,seq);event("ack",code,now);}
    synchronized JSONObject snapshot(long now,int actions,int hearts) {
        try {return new JSONObject().put("stage",stage).put("error",error).put("requests",requests).put("sent",sent).put("received",received)
            .put("revision",revision).put("stateAgeSec",lastState<0?-1:Math.max(0,now-lastState)/1000).put("ackSeq",ackSeq)
            .put("actions",Math.max(0,actions)).put("hearts",Math.max(0,hearts));} catch(Exception e) {return new JSONObject();}
    }
    static boolean enabled(Context c) {return (c.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0;}
    static void note(Context c,String stage,String code) {
        live.event(stage,code,SystemClock.elapsedRealtime());
        if(enabled(c)) {JSONObject value=live.snapshot(SystemClock.elapsedRealtime(),0,0);Log.d("OpenGymSync","watch stage="+value.optString("stage")+" error="+value.optString("error"));}
    }
    static void stateReceived(Context c,long revision) {live.received(revision,SystemClock.elapsedRealtime());if(enabled(c)) Log.d("OpenGymSync","watch state revision="+revision);}
    static void acknowledged(Context c,int seq,String code) {live.ack(seq,code,SystemClock.elapsedRealtime());if(enabled(c)) Log.d("OpenGymSync","watch ack seq="+Math.max(0,seq)+" error="+live.snapshot(SystemClock.elapsedRealtime(),0,0).optString("error"));}
}
