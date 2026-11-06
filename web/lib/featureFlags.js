// Features still being finished. Off unless switched on for a deployment (Vercel env var, read at
// build time), so they can be tried on a Preview without reaching students.
//   NEXT_PUBLIC_GAMES=1             the Games tab on guides (/play: Blocks)
//   NEXT_PUBLIC_EXTRA_CONNECTORS=1  Google Sheets, GitHub, Slack and Dropbox in Connectors (and the
//                                   GitHub repo link on assignments). Their backend routes stay on.
//   NEXT_PUBLIC_LEARN_LADDER_V2=1   Learn's format ladder (lib/learnLadder.mjs): Fill in the blank and
//                                   Written tiles, recall to master, longer retry gaps in Learn and
//                                   Quiz, "What's the test like?", final-days practice. Pair it with
//                                   LEARN_LADDER_V2=true on the backend (Fly) for saved blanks.
//   NEXT_PUBLIC_PER_VIEWER_PROGRESS=1  Study other people's shared guides (Flashcards, Learn, Quiz) with
//                                   your own progress, and "Update available" when the author edits.
//                                   Pair it with PER_VIEWER_PROGRESS=true on the backend after
//                                   migration 20261112120000_guide_progress.sql.
export const GAMES_ON = process.env.NEXT_PUBLIC_GAMES === '1';
export const EXTRA_CONNECTORS_ON = process.env.NEXT_PUBLIC_EXTRA_CONNECTORS === '1';
export const EXTRA_CONNECTORS = ['gsheets', 'github', 'slack', 'dropbox'];
export const LEARN_LADDER_V2 = process.env.NEXT_PUBLIC_LEARN_LADDER_V2 === '1';
export const PER_VIEWER_PROGRESS = process.env.NEXT_PUBLIC_PER_VIEWER_PROGRESS === '1';
