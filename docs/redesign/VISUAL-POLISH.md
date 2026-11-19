# Visual polish and delight (V1 to V3)

From Jude, 2026-11-19. Opus for all three (UI). Queued after F11 and F6b, ahead of F4's fix round. Each is its own DRAFT pull request with a preview link, a review, the `director-review` status, then "ready to merge". Web only, no backend deploy. Lean rules; website-finish in fix mode; everything in light and dark; reduced motion respected (motion becomes an instant change). Avoid: neon glows, gradient text, animating everything. Every motion has a job.

Not in scope (planned elsewhere): math rendering, step-by-step cards and diagram cards (CC4); voice-mode visuals beyond the presence ring (F11).

## V1 Fixes
1. Folded sidebar: each class dot shows a tooltip with the class name and code on hover and focus, and the dot carries the course code's first two letters (for example "EH", "MA") in the class colour with readable contrast. Same for folded tool and nav icons.
2. Composer focus: replace the heavy dark outline with a 2px olive focus ring at about 60% plus a soft 4px olive-tint halo, still clearly visible for keyboard users (3:1 against the glass).
3. Wide screens: from 1600px up, the home's headline and composer scale up (headline about 48px, composer up to 860px wide) so the home doesn't sit small in empty space.
4. The date line top right becomes a context line: "Wednesday · MA 125 exam in 1 day" when an exam is within 7 days, otherwise just the day and date.

## V2 Motion that makes it feel native
1. Send glide: sending from the home animates the composer from the centre to its docked place at the bottom while the student's message rises into the conversation, about 420ms with the standard ease-out. The headline and suggestions fade out in the first 150ms. View Transitions API where supported, CSS transform fallback; never animate width, height or margin. No layout shift after it lands.
2. Tutor presence: the Cordia mark is the Tutor's presence everywhere it appears. It breathes slowly while idle, pulses faster while the Tutor is thinking (alongside the T4b thinking lines), and in voice mode (F11) becomes a soft ring that responds to the audio level while listening and speaking. One component, used in chat, the Tutor drawer and voice mode.
3. Progress you can feel: when an idea moves up to Mastered in Learn, a small glass "Mastered" pill rises and fades near the question (about 900ms). Readiness rings animate from their old value to the new one whenever they change. Finishing a Learn round with every idea moving up gets a short confetti burst (under 1 second, about 40 pieces) in that class's colour. No sound.
4. Class colour: inside a class's chat or a class page, the chat header and the composer's class chip take a soft tint of that class's colour (8 to 12%), never on body text.

## V3 Time-of-day sky
Also a Make it yours option, "Sky follows the time", on by default for the Clouds background.
- Morning (6 to 11): the current sky, a little brighter.
- Day (11 to 17): the current sky.
- Evening (17 to 20): a gentle warm wash over the clouds (soft peach at about 8% from the bottom).
- Night (20 to 6): a deep blue-grey night version of the backdrop with a few faint static stars; dark mode follows it only if the student chose Match device.
- The changeover is a slow 3-second crossfade at most once per period, using the device's local time. Text contrast stays at 4.5:1 in every period. Turned off automatically for Solid glass, reduced transparency and Paper & Clay.

## Director's notes
- V2.2 depends on T4b (thinking lines) and F11 (voice mode), both earlier in the queue; V2.4 uses the class page from T7 if it has landed, else the current class page.
- V3's Make it yours option extends the T10 theme engine (`web/lib/themeSettings.mjs`, `tokens.css`); new colours as tokens in light and dark.
