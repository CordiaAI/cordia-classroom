import { useNewShell } from '../../lib/useNewShell';
import { LoadingArea } from '../../components/CordiaLoader';
import ClassPageLegacy from '../../components/ClassPageLegacy';
import ClassProject from '../../components/ClassProject';

// A class page. With the new shell on and a window 768px or wider (lib/useNewShell.js), the class
// works like a project (components/ClassProject.js, docs/redesign/PLAN.md T7): its header, a
// composer scoped to the class, the tabs, the exam card and Due soon. Otherwise it is today's page
// (components/ClassPageLegacy.js), unchanged. While the page hydrates neither shows yet, so one
// never flashes before the other; both load their data behind the same breathing mark.
export default function ClassPage() {
  const shell = useNewShell();
  if (shell === null) return <LoadingArea phase="waiting" label="Loading class" />;
  return shell ? <ClassProject /> : <ClassPageLegacy />;
}
