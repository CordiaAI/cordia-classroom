// Features still being finished. Off unless switched on for a deployment (Vercel env var, read at
// build time), so they can be tried on a Preview without reaching students.
//   NEXT_PUBLIC_GAMES=1             the Games tab on guides (/play: Blocks)
//   NEXT_PUBLIC_EXTRA_CONNECTORS=1  Google Sheets, GitHub, Slack and Dropbox in Connectors (and the
//                                   GitHub repo link on assignments). Their backend routes stay on.
export const GAMES_ON = process.env.NEXT_PUBLIC_GAMES === '1';
export const EXTRA_CONNECTORS_ON = process.env.NEXT_PUBLIC_EXTRA_CONNECTORS === '1';
export const EXTRA_CONNECTORS = ['gsheets', 'github', 'slack', 'dropbox'];
