import {
  Brain, CalendarDays, ChartColumn, Layers, MessageCircle, NotebookPen, PencilRuler, Sparkles, SquarePlus, Timer, TreeDeciduous, Upload,
} from 'lucide-react';

// Every feature, in the order a student meets them. Ids match MINI walkthroughs.
export const FEATURE_LIST = [
  { id: 'add', label: 'Add material', icon: Upload },
  { id: 'explain', label: 'Explain', icon: Sparkles },
  { id: 'card', label: 'Make card', icon: SquarePlus },
  { id: 'quiz', label: 'Quiz', icon: Brain },
  { id: 'ask', label: 'Tutor', icon: MessageCircle },
  { id: 'cards', label: 'Cards', icon: Layers },
  { id: 'practice', label: 'Practice', icon: PencilRuler },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'focus', label: 'Focus', icon: Timer },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'insights', label: 'Insights', icon: ChartColumn },
  { id: 'grove', label: 'Grove', icon: TreeDeciduous },
];

// Some features only count once really used: Calendar when a feed is connected, Notes when
// a note has text. (Older accounts were ticked just for opening those pages.)
const USED_KEY = { calendar: 'calendar-connected', notes: 'note-written' };

export function featureUsed(progress, id) {
  return (progress?.used || []).includes(USED_KEY[id] || id);
}
