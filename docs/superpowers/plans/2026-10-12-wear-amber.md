# Wear Amber Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the approved change.

**Goal:** Apply the user's selected Material 3 amber preview to the watch.
**Architecture:** Keep the existing native Activity and behavior. Centralize tonal colors, vector icons and state-aware rounded/edge-shaped button surfaces in WearStyle.
**Tech Stack:** Java, Android Drawables, existing Gradle instrumentation tests.
**Spec:** User-approved amber mockup: primary #F4D06F, rest #BFD5A3, secondary #373222, near-black background. Large touch areas; connection dot only offline.

## Constraints
- Preserve existing uncommitted phone/watch fixes in this checkout.
- No new runtime dependencies or changes to communication behavior.
- Preserve localization, pending/disabled states and accessible labels.
- No commit, deployment or physical-device installation requested.

## Review Focus
- All 16 screens fit the round display with 48dp touch targets.
- Disabled buttons and icons have subdued ink.
- Pending actions do not show a misleading action icon.
- Timer icon changes on pause/resume and theme updates do not reset the timer.
- Offline dot and reconnect visibility remain correct.

## Task 1: Native theme and icons
- [x] Update existing UI test to verify a vector completion icon rather than a text glyph; run before implementation.
- [x] Add WearStyle and integrate amber, sage and tonal surfaces across all pages.
- [x] Use an edge-shaped primary completion surface and vector compound drawables.
- [x] Build and run watch unit and instrumentation suites.
- [x] Inspect real screenshots of workout, rest, options and editors; fix any clipping.
- [x] Review the changes and report APK plus real previews.

## Execution notes
User explicitly authorized implementation after approving the mockups. Continue in the existing checkout to preserve the ongoing uncommitted work; no plan approval pause or unrelated refactor.

Validation: 16 unit tests and 12 emulator instrumentation tests passed. Real captures checked for enabled, disabled, pending, rest, options, heart and editor states. Fresh reviewer found no concrete regressions. Native Java Drawables retain the existing communication architecture; no dependency migration or publish. Emulator previews: frontend/android/build/wear-amber-preview/.
