# Printable quiz and feedback timing: review files

- `approved-samples/`: the owner's approved layouts (Mixed, All multiple choice, All short answer).
- `music-101/`: the same layouts printed by the new `/print/quiz/[id]` page from the Music 101 guide
  (`f87c16a0-7f44-4074-a192-9ae2e8913eb0`): Mixed, All multiple choice, All short answer, All fill in the
  blank and All matching. Rendered with Chromium's "Save as PDF" (Letter, the page's own margins).
- `feedback-modes/`: "Show if I'm right" screens: the setting, a When-I-submit question with the
  navigator and a flag, the unanswered warning, the results, Retry my misses, After each question,
  and the Timed test in both modes.

Notes on the Music 101 PDFs:

- Multiple choice comes from the guide's saved quiz. 14 of its 50 questions offer another question's
  answer as a wrong choice (for example "Absolute music is..." for "What is program music?"), so
  they're left out of the printout until the student uses Refresh answer choices.
- Matching and short answer are picked from the guide's own questions and answers, without AI.
- The fill-in sentences in these PDFs were written in the build session (no Anthropic key there) and
  passed the same check production applies to Haiku's sentences: every blank is copied word for
  word from the stored answer, and the sentence adds nothing the question and answer don't say.
- All matching asks for 16 terms; this guide has 14 term-definition pairs, and each block of terms
  keeps one spare definition, so it prints 12 (the print page says so).
