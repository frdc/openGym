package com.fredc.opengym;

import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearOfflineUiTest {
 private View find(View v,String tag) {
  if(tag.equals(v.getTag()))return v;
  if(v instanceof ViewGroup g)for(int i=0;i<g.getChildCount();i++){View found=find(g.getChildAt(i),tag);if(found!=null)return found;}
  return null;
 }
 private void field(WearActivity a,String name,Object value)throws Exception {var f=WearActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(a,value);}
 private void invoke(WearActivity a,String name)throws Exception{var m=WearActivity.class.getDeclaredMethod(name);m.setAccessible(true);m.invoke(a);}
 @Test public void offlineDecimalEditIsDurableAndAChangedSetCannotReceiveIt()throws Exception {
  var i=InstrumentationRegistry.getInstrumentation();var ctx=i.getTargetContext();WearOutbox.clear(ctx);
  WearActivity a=(WearActivity)i.startActivitySync(new Intent(ctx,WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  try {i.runOnMainSync(()->{try{
   JSONObject current=new JSONObject().put("name","Supino").put("setLabel","2/4").put("entryIdx",0).put("setIdx",1).put("canEdit",true).put("canComplete",true).put("loadValue",25.4).put("loadUnit","kg").put("loadStep",6.8).put("loadStart",11.8).put("repsValue",10);
   JSONObject state=new JSONObject().put("active",true).put("contextToken","offline-test").put("revision",1).put("current",current);
   field(a,"state",state);field(a,"phone","");field(a,"confirmedAt",0L);invoke(a,"render");
   View root=a.getWindow().getDecorView();assertTrue(find(root,"edit-load").isEnabled());
   find(root,"edit-load").performClick();find(root,"increase").performClick();
   assertTrue(((android.widget.TextView)find(root,"draft-value")).getText().toString().matches("32[.,]2 kg"));
   find(root,"confirm-edit").performClick();
   JSONObject stored=WearOutbox.read(ctx);assertNotNull(stored);assertEquals(32.2,stored.getDouble("value"),0);
   String id=stored.getString("requestId");assertEquals(id,WearOutbox.read(ctx.createPackageContext(ctx.getPackageName(),0)).getString("requestId"));
   assertFalse(find(root,"edit-load").isEnabled());
   current.put("setIdx",2);state.put("revision",2);field(a,"phone","test-phone");field(a,"confirmedAt",android.os.SystemClock.elapsedRealtime());invoke(a,"drainOutbox");
   assertTrue(WearOutbox.conflicted(ctx));assertEquals(id,WearOutbox.read(ctx).getString("requestId"));
  }catch(Exception e){throw new RuntimeException(e);}});
  }finally{i.runOnMainSync(a::finish);WearOutbox.clear(ctx);}
 }
}
