import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TagidAI · השקה בקרוב',
  description: 'פלטפורמה לקבלנים ולתאגידי כוח אדם בענף הבנייה',
};

export default function ComingSoonLayout({ children }: { children: React.ReactNode }) {
  return children;
}
