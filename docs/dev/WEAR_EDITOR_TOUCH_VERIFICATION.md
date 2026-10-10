# Watch edit controls and heart — 2026-10-10

User clarified that the difficult reps/load controls were on the watch, not the phone. The temporary mobile CSS changes were removed and the phone APK rebuilt/reinstalled to restore its previous controls. No input/value stepping rules were changed.

Watch draft editor minus/plus buttons are now 56 dp tall, with 28 sp symbols, lighter surface and a visible outline. An 8 dp gap separates adjustments from Confirm/Cancel. The heart uses a symmetric rounded native path and fresh readings color #FF3B4F; stale/stopped collection remains gray and the existing freshness/pulse rules remain.

Verification: watch JVM suite passed, both APKs built and installed with install -r. Physical Ultra screenshot `.superpowers/watch-load-large.png` confirms complete buttons fit the circular screen. Tapping plus changed the draft from 15 to 17.5 kg; Cancel returned to main with persisted load still 15 kg, confirmed in the received snapshot. Collection was re-enabled after APK replacement; immediate screenshot showed the expected gray waiting-for-fresh-data state. No fresh-red screenshot was captured in this run. Existing frontend numeric-input/stepper suites passed 19 tests; no full frontend suite rerun for this visual change.

Installed APK hashes:

- Phone: e4fa75d202dabba3a78dd731dcf72fdc0a87eec914b603083a012559c4714284
- Watch: 1d5b24d6d7653c41bb000407b2e1cc9da6b3049fe68e5202ce57b0becf2d6be4
