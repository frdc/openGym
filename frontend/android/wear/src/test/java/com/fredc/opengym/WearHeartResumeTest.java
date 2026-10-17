package com.fredc.opengym;
import org.junit.Test;
import static org.junit.Assert.*;
public class WearHeartResumeTest {
    @Test public void resumesOnlyPreviouslyChosenSameVerifiedWorkout() {
        assertTrue(WearHeartResume.allowed("workout-a","workout-a",true,true,true));
        assertFalse(WearHeartResume.allowed("","workout-a",true,true,true));
        assertFalse(WearHeartResume.allowed("workout-a","workout-b",true,true,true));
        assertFalse(WearHeartResume.allowed("workout-a","workout-a",false,true,true));
        assertFalse(WearHeartResume.allowed("workout-a","workout-a",true,false,true));
        assertFalse(WearHeartResume.allowed("workout-a","workout-a",true,true,false));
    }
}
