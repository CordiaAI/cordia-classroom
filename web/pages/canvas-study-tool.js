import UseCasePage from '../components/UseCasePage';
import page from '../lib/useCases/canvasStudyTool.mjs';

// Studying with Canvas: what Cordia reads, connecting, safety and sync. The copy lives in lib/useCases/.
export default function CanvasStudyTool() {
  return <UseCasePage page={page} />;
}
