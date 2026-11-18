import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { AppShell } from '@/components/layout/AppShell'

export default function App() {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={120}>
      <AppShell />
    </TooltipPrimitive.Provider>
  )
}
