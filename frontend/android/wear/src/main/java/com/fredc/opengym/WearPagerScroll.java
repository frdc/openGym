package com.fredc.opengym;

import android.content.Context;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.ScrollView;

/** Horizontal page gestures cancel child taps; vertical scrolling and modal editors stay independent. */
final class WearPagerScroll extends ScrollView {
    interface Pages { boolean available(); boolean settings(); void show(boolean settings); }
    private final Pages pages;
    private float downX, downY;
    private boolean paging;
    WearPagerScroll(Context context, Pages pages) { super(context); this.pages = pages; }
    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { downX = event.getX(); downY = event.getY(); paging = false; }
        if (event.getActionMasked() == MotionEvent.ACTION_MOVE && pages.available()) {
            float dx = event.getX() - downX, dy = event.getY() - downY;
            if (Math.abs(dx) > 24 * getResources().getDisplayMetrics().density && Math.abs(dx) > Math.abs(dy) * 1.15f) {
                paging = true; return true;
            }
        }
        return paging || super.onInterceptTouchEvent(event);
    }
    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!paging) return super.onTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP) { paging = false; if (pages.available()) pages.show(event.getX() < downX); }
        if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) paging = false;
        return true;
    }
    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo node) {
        super.onInitializeAccessibilityNodeInfo(node);
        if (pages.available()) node.addAction(pages.settings() ? AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_LEFT : AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_RIGHT);
    }
    @Override public boolean performAccessibilityAction(int action, Bundle args) {
        if (pages.available() && (action == AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_RIGHT.getId() || action == AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_LEFT.getId())) {
            pages.show(action == AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_RIGHT.getId()); return true;
        }
        return super.performAccessibilityAction(action,args);
    }
}
