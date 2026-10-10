# Phase clarity — physical investigation, 2026-10-10

User reported unclear Start/Complete/rest behavior and authorized using the active Livre / 3/4 Sit-Up workout as a test. Both physical screens were captured through ADB. No unrelated devices were controlled.

## Findings and fixes

- Confirmed set 2 effort on watch matched phone set 1 done / set 2 open. Completing set 2 changed capture to recovery and created a 90-second rest on both devices. Starting set 3 removed rest and created a new effort binding. Transport/phase transitions worked in this reproduction.
- Main screen reused the same unlabeled timer across effort and rest, while showing the next set number during rest. Added a compact phase/series subtitle: Em série, Descanso, Descanso pausado or Pronto. Buttons now say Iniciar série and Concluir série in Portuguese.
- Phone snapshot contained lang=pt-BR, but watch used its system English resources. Activity now selects localized resources from the workout snapshot without changing system settings.
- Last-set completion previously showed the instruction to open a workout despite an active completed session. It now explicitly says the sets are completed and workout finalization belongs on the phone.
- APK replacement interrupted the heart service; Health Services retained OpenGym's owned exercise. The former check treated all existing exercises as another-app conflicts. OWNED_EXERCISE_IN_PROGRESS now reattaches the callback and maintenance loop; other-app conflicts remain blocked. This matches the official ExerciseClient recovery contract. Physically re-enabling collection then succeeded and fresh readings returned.

## Verification

- Watch unit suite passed and debug APK compiled. Installed with install -r on SM-L705F; data retained. Phone APK unchanged.
- Added sets 4 and 5 to this authorized test session to validate the corrected UI. Set 4 Start and Complete physically succeeded; phone/watch entered a 90-second rest for set 5. Screen captures confirm phase labels, Portuguese controls and chips within the round screen.
- Private local captures: .superpowers/watch-ready-final.png, watch-effort-final.png, watch-rest-clear.png, watch-ready-after-rest.png, watch-fixed-finished.png. Some immediate captures caught incomplete display frames; the stabilized rest capture and UI hierarchy confirmed both reps/load buttons present and enabled.
- Test set 5 was left unfinished so the user can continue testing. These are synthetic test repetitions/durations, not an actual exercise performance measurement. The workout was not finalized or deleted.

Installed watch APK SHA-256: ac9f6284c766a9c9de7b8e7170b60b383b8811660f6034109e2e7468e2114a5c.

Remaining limitations: workout finalization still uses the phone; explicit Start/effort marking currently requires heart collection enabled. Paused-rest label is implemented but was not physically exercised in this run. This verification does not imply a fresh full frontend suite run.
