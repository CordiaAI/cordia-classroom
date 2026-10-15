// The only three breakpoints. CSS uses the same numbers (checked by tests/breakpoints.test.mjs):
//   phone   < 640   -> @media (max-width: 639px)
//   tablet  < 1024  -> @media (max-width: 1023px)   (tab bar, single column)
//   desktop >= 1280 -> @media (min-width: 1280px)
export const BREAKPOINTS = { sm: 640, md: 1024, lg: 1280 };
