package com.fredc.opengym;
import org.junit.Test;
import static org.junit.Assert.*;
public class WearEditorTest {
 @Test public void decimalLoadStepAndIntegerReps() {
  WearEditor load = new WearEditor("ctx", "2:1:left", "w", "kg", 40, 2.5);
  load.adjust(1); assertEquals(42.5, load.value, 0); load.adjust(-1); assertEquals(40, load.value, 0);
  WearEditor reps = new WearEditor("ctx", "2:1:left", "r", "kg", 10, 2.5);
  reps.adjust(1); assertEquals(11, reps.value, 0);
 }
 @Test public void unrelatedRevisionAndOtherFieldRetainDraftButBaselineChangesInvalidate() {
  WearEditor draft = new WearEditor("ctx", "2:1:left", "w", "kg", 40, 2.5); draft.adjust(1);
  assertTrue(draft.matches("ctx", "2:1:left", "kg", 40));
  assertFalse(draft.matches("ctx", "2:1:left", "kg", 42.5));
  assertFalse(draft.matches("owner2", "2:1:left", "kg", 40));
  assertFalse(draft.matches("ctx", "2:1:right", "kg", 40));
  assertFalse(draft.matches("ctx", "2:1:left", "lb", 40));
 }
 @Test public void pendingRejectsAdjustmentAndBoundsStayValid() {
  WearEditor draft = new WearEditor("ctx", "0:0:", "r", "kg", 0, 1);
  draft.adjust(-1); assertEquals(0, draft.value, 0);
  draft.pending = true; draft.adjust(1); assertEquals(0, draft.value, 0);
 }
 @Test public void blankFieldStartsAtZeroAndInvalidatesWhenPhoneFillsIt() {
  WearEditor draft = new WearEditor("ctx", "0:0:", "w", "kg", Double.NaN, 2.5);
  assertEquals(0, draft.value, 0); assertTrue(draft.matches("ctx", "0:0:", "kg", Double.NaN));
  draft.adjust(1); assertEquals(2.5, draft.value, 0);
  assertFalse(draft.matches("ctx", "0:0:", "kg", 0));
 }
 @Test public void heartRequiresRunningValidRecentNonfutureReading() {
  assertTrue(WearEditor.heartFresh(true, 80, 1000, 16000));
  assertFalse(WearEditor.heartFresh(true, 80, 1000, 16001));
  assertFalse(WearEditor.heartFresh(false, 80, 1000, 1000));
  assertFalse(WearEditor.heartFresh(true, Double.NaN, 1000, 1000));
  assertFalse(WearEditor.heartFresh(true, 80, 1001, 1000));
 }
}
