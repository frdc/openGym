package com.fredc.opengym;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Fail closed: never replace an unreadable journal with an empty one. */
final class WearInbox {
    interface Store { String read() throws Exception; void write(String value) throws Exception; }
    private final Store store;
    private JSONArray entries;
    private static final int MAX_BYTES=8*1024*1024, MAX_ITEMS=512;
    WearInbox(Store store) throws Exception {
        this.store=store;String saved=store.read();
        if(saved!=null && saved.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES) throw new Exception("inbox full");
        entries=saved==null?new JSONArray():new JSONArray(saved);
        if(entries.length()>MAX_ITEMS) throw new Exception("inbox full");
        for(int i=0;i<entries.length();i++) {JSONObject row=entries.getJSONObject(i);row.getString("key");row.getString("nodeId");row.getString("kind");row.getJSONObject("payload");}
    }
    synchronized String offer(String node,String kind,JSONObject payload) throws Exception {
        if(node==null || node.isEmpty() || node.length()>200 || !("command".equals(kind)||"heart".equals(kind))) throw new Exception("invalid entry");
        byte[] raw=(node+"\n"+kind+"\n"+payload.toString()).getBytes(StandardCharsets.UTF_8);
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(raw);StringBuilder id=new StringBuilder();
        for(byte b:hash) id.append(String.format("%02x",b&255));String key=id.toString();
        for(int i=0;i<entries.length();i++) if(key.equals(entries.getJSONObject(i).getString("key"))) return key;
        if(entries.length()>=MAX_ITEMS) throw new Exception("inbox full");
        JSONArray next=new JSONArray(entries.toString());next.put(new JSONObject().put("key",key).put("nodeId",node).put("kind",kind).put("payload",new JSONObject(payload.toString())));
        commit(next);return key;
    }
    synchronized JSONArray list(String after,int requested) throws Exception {
        List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<entries.length();i++) sorted.add(entries.getJSONObject(i));
        sorted.sort(Comparator.comparing(row->row.optString("key")));JSONArray result=new JSONArray();
        int limit=Math.max(1,Math.min(64,requested));
        for(JSONObject row:sorted) if(row.getString("key").compareTo(after)>0 && result.length()<limit) result.put(new JSONObject(row.toString()));
        return result;
    }
    synchronized boolean remove(String key,String node,String kind,String requestId) throws Exception {
        JSONArray next=new JSONArray();boolean found=false;
        for(int i=0;i<entries.length();i++) {
            JSONObject row=entries.getJSONObject(i);
            if(key.equals(row.getString("key"))) {
                if(!node.equals(row.getString("nodeId")) || !kind.equals(row.getString("kind")) || !requestId.equals(row.getJSONObject("payload").optString("requestId"))) return false;
                found=true;
            } else next.put(row);
        }
        if(found) commit(next);return found;
    }
    private void commit(JSONArray next) throws Exception {
        String value=next.toString();if(value.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES) throw new Exception("inbox full");
        store.write(value);entries=next;
    }
}
