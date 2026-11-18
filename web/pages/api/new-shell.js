// GET -> { newShell: true | false }: is the new app shell on for the signed-in account? The answer
// is the only thing sent: no list, no reason, no id (lib/server/newShell.mjs).
import { createShellRoute } from '../../lib/server/newShell.mjs';

export default createShellRoute();
