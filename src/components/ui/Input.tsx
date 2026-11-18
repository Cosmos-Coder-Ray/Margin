import { forwardRef, type InputHTMLAttributes } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  loading?: boolean
  leading?: React.ReactNode
  trailing?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error = false, loading = false, leading, trailing, disabled, ...props }, ref) => (
    <span className={cn('input-wrap', error && 'input-error', (disabled || loading) && 'input-disabled', loading && 'input-loading')}>
      {leading && <span className="input-adornment">{leading}</span>}
      <input
        ref={ref}
        className={cn('input', className)}
        disabled={disabled || loading}
        aria-invalid={error || undefined}
        aria-busy={loading || undefined}
        {...props}
      />
      {loading ? <LoaderCircle className="button-spinner input-spinner" aria-hidden="true" /> : trailing && <span className="input-adornment">{trailing}</span>}
    </span>
  ),
)
Input.displayName = 'Input'
