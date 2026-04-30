'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavDrawerProps {
  /** The navigation content to render inside the drawer (typically <Sidebar />). */
  nav: React.ReactNode;
  className?: string;
}

/**
 * Hamburger button + slide-over drawer. Visible only below the `lg:`
 * breakpoint — the desktop sidebar handles wider screens. Slides in from
 * the start side (right in RTL) so the trigger and the drawer share the
 * same edge of the screen, which is the expected mobile pattern.
 *
 * The drawer auto-closes when a link inside it is clicked, so navigation
 * doesn't leave the user staring at an open menu on the destination page.
 */
export default function MobileNavDrawer({ nav, className }: MobileNavDrawerProps) {
  const [open, setOpen] = useState(false);

  // Bubble-up: any <a> click inside the drawer closes it. Cheaper than
  // threading an onLinkClick prop through every Sidebar item.
  function closeOnLinkClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="פתיחת תפריט"
          className={cn(
            'inline-flex items-center justify-center h-9 w-9 rounded-lg',
            'text-slate-600 hover:bg-slate-100 transition-colors',
            'lg:hidden',
            className
          )}
        >
          <Menu className="h-5 w-5" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          // The drawer is fixed to the start edge of the viewport. In RTL
          // that's the right side; we use logical `start-0` so the same
          // class works in either direction.
          className="fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] bg-slate-900 shadow-2xl"
        >
          <Dialog.Title className="sr-only">תפריט ניווט</Dialog.Title>
          <Dialog.Description className="sr-only">
            תפריט הניווט הראשי של הפלטפורמה
          </Dialog.Description>

          {/* Close button — overlays the drawer header at the end edge. */}
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="סגירת תפריט"
              className={cn(
                'absolute top-3 end-3 z-10 h-8 w-8 rounded-md',
                'inline-flex items-center justify-center',
                'text-slate-400 hover:text-white hover:bg-slate-800 transition-colors',
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          <div onClick={closeOnLinkClick} className="h-full overflow-y-auto">
            {nav}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
