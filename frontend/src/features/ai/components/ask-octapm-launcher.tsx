import { MessageCircleQuestion } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AssistantDrawerHost } from '@/features/assistant/components/assistant-sheet'
import { useAiDrawer } from '@/stores/ai-drawer-store'

/**
 * Ask OctaPM on every authenticated screen (owner, 2026-10-11): the one
 * drawer, mounted once here in the shell, and a floating bottom-right button
 * that opens it over whatever screen is showing. Another entry point into the
 * same assistant, beside the header button and the screens' AI actions; the
 * drawer reads the screen it is over (use-ai-screen-context).
 *
 * The button sits under dialogs and drawers (z-40), clear of the iOS home
 * bar (safe-area inset), and hides while the drawer is open (the drawer has
 * its own close). Toasts are offset above it (routes/__root).
 */
export function AskOctaPMLauncher() {
  const canAsk = useCanPerform('assistant', 'read')
  const open = useAiDrawer((state) => state.open)
  const openDrawer = useAiDrawer((state) => state.openDrawer)

  return (
    <>
      <AssistantDrawerHost />
      {canAsk && !open && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              aria-label='Ask OctaPM'
              onClick={() => openDrawer()}
              data-testid='uat-ask-octapm-fab'
              className={cn(
                'group fixed z-40 flex items-center justify-center gap-2 rounded-full',
                'bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-6',
                'size-12 sm:h-14 sm:w-14 sm:hover:w-auto sm:hover:px-5 sm:focus-visible:w-auto sm:focus-visible:px-5',
                'bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-black/5',
                'transition-[width,padding,transform,box-shadow] duration-200 hover:shadow-xl motion-safe:hover:-translate-y-0.5',
                'outline-none focus-visible:ring-4 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
              )}
            >
              <MessageCircleQuestion className='size-6 shrink-0' aria-hidden />
              <span className='hidden text-sm font-semibold whitespace-nowrap sm:group-hover:inline sm:group-focus-visible:inline'>
                Ask OctaPM
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='left'>Ask OctaPM about this screen</TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
