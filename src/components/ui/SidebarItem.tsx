import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface SidebarItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon
  label: string
  selected?: boolean
  child?: boolean
  depth?: number
  expanded?: boolean
  count?: number
  trailing?: ReactNode
}

export function SidebarItem({
  icon: Icon,
  label,
  selected,
  child,
  depth = 1,
  expanded,
  count,
  trailing,
  className,
  ...props
}: SidebarItemProps) {
  return (
    <button
      type="button"
      className={cn('sidebar-item', selected && 'sidebar-item-selected', child && 'sidebar-item-child', className)}
      style={child ? { '--sidebar-depth': depth } as React.CSSProperties : undefined}
      aria-current={selected ? 'page' : undefined}
      {...props}
    >
      {Icon && <Icon className="sidebar-item-icon" aria-hidden="true" />}
      <span className="sidebar-item-label">{label}</span>
      {typeof count === 'number' && <span className="sidebar-item-count">{count}</span>}
      {trailing}
      {typeof expanded === 'boolean' && (
        expanded
          ? <ChevronDown className="sidebar-item-chevron" aria-hidden="true" />
          : <ChevronRight className="sidebar-item-chevron" aria-hidden="true" />
      )}
    </button>
  )
}
