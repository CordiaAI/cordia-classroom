import { MINI, startWalkthrough } from './walkthrough';
import { lastGuide } from './userStore';

// "Show me": open the feature's screen and spotlight its control.
export async function showMe(router, id) {
  const mini = MINI[id];
  if (!mini) return;
  let route = mini.route;
  if (route === 'guide') {
    const guide = lastGuide();
    route = guide ? `/guide/${guide.id}` : '/library';
  }
  if (route && router.asPath.split('?')[0] !== route) await router.push(route);
  if (mini.steps.length) startWalkthrough(id);
}
