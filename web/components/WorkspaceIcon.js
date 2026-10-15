import {
  ArrowRight, BookOpen, CalendarDays, ChevronLeft, House, Layers, MessageCircle, NotebookPen, PencilRuler, Upload, User,
} from 'lucide-react';

// Legacy icon names mapped onto the one Lucide set (20px, 1.75 stroke).
const ICONS = {
  home: House,
  study: BookOpen,
  notes: NotebookPen,
  flashcards: Layers,
  practice: PencilRuler,
  calendar: CalendarDays,
  profile: User,
  tutor: MessageCircle,
  chevron: ChevronLeft,
  arrow: ArrowRight,
  upload: Upload,
};

export default function WorkspaceIcon({ name, className = '', size = 20 }) {
  const Icon = ICONS[name] || BookOpen;
  return <Icon className={className} size={size} strokeWidth={1.75} aria-hidden="true" />;
}
