package com.fredc.opengym;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

final class WearInboxStore {
    private static WearInbox inbox;
    static synchronized WearInbox get(Context context) throws Exception {
        if(inbox==null) {
            AtomicFile file=new AtomicFile(new File(context.getApplicationContext().getFilesDir(),"wear-inbox.json"));
            inbox=new WearInbox(new WearInbox.Store() {
                public String read() throws Exception {
                    try { return new String(file.readFully(),StandardCharsets.UTF_8); }
                    catch(FileNotFoundException e) { if(file.getBaseFile().exists() || new File(file.getBaseFile()+".bak").exists()) throw e;return null; }
                }
                public void write(String value) throws Exception {
                    FileOutputStream stream=null;
                    try { stream=file.startWrite();stream.write(value.getBytes(StandardCharsets.UTF_8));file.finishWrite(stream); }
                    catch(Exception e) {if(stream!=null) file.failWrite(stream);throw e;}
                }
            });
        }
        return inbox;
    }
}
