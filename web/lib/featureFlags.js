// Features still being finished. Off unless switched on for a deployment (Vercel env var, read at
// build time), so they can be tried on a Preview without reaching students.
//   NEXT_PUBLIC_GAMES=1  the Games tab on guides (/games, /play: Blocks)
export const GAMES_ON = process.env.NEXT_PUBLIC_GAMES === '1';
