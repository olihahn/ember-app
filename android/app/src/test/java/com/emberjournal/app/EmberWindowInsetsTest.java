package com.emberjournal.app;

import static org.junit.Assert.assertEquals;

import androidx.core.graphics.Insets;
import org.junit.Test;

public class EmberWindowInsetsTest {
    @Test
    public void portraitProtectsStatusBarAndLargerCameraCutout() {
        assertEquals(
            Insets.of(0, 96, 0, 48),
            EmberWindowInsets.padding(Insets.of(0, 72, 0, 48), Insets.of(0, 96, 0, 0), Insets.NONE)
        );
    }

    @Test
    public void keyboardReplacesNavigationInsetInsteadOfAddingIt() {
        assertEquals(
            Insets.of(0, 72, 0, 900),
            EmberWindowInsets.padding(Insets.of(0, 72, 0, 48), Insets.NONE, Insets.of(0, 0, 0, 900))
        );
    }

    @Test
    public void hiddenOrFloatingKeyboardKeepsNavigationProtection() {
        assertEquals(
            Insets.of(0, 72, 0, 48),
            EmberWindowInsets.padding(Insets.of(0, 72, 0, 48), Insets.NONE, Insets.NONE)
        );
    }

    @Test
    public void landscapeProtectsSideCutoutAndSideNavigation() {
        assertEquals(
            Insets.of(96, 48, 72, 0),
            EmberWindowInsets.padding(Insets.of(0, 48, 72, 0), Insets.of(96, 0, 0, 0), Insets.NONE)
        );
        assertEquals(
            Insets.of(72, 48, 96, 0),
            EmberWindowInsets.padding(Insets.of(72, 48, 0, 0), Insets.of(0, 0, 96, 0), Insets.NONE)
        );
    }

    @Test
    public void gestureAndThreeButtonNavigationUseTheirReportedBounds() {
        for (int bottom : new int[] { 24, 48, 144 }) {
            assertEquals(
                Insets.of(0, 72, 0, bottom),
                EmberWindowInsets.padding(Insets.of(0, 72, 0, bottom), Insets.NONE, Insets.NONE)
            );
        }
        assertEquals(Insets.NONE, EmberWindowInsets.padding(Insets.NONE, Insets.NONE, Insets.NONE));
    }
}
