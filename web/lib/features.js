import {
  Brain, CalendarDays, ChartColumn, Layers, Link2, MessageCircle, NotebookPen, PencilRuler, Sparkles, SquarePlus, Timer, Upload,
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
  { id: 'canvas', label: 'Canvas', icon: Link2 },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'focus', label: 'Focus', icon: Timer },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'insights', label: 'Insights', icon: ChartColumn },
];
