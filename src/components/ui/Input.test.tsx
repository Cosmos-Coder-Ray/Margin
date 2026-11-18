import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from './Input'

describe('Input', () => {
  it('exposes its invalid state to assistive technology', () => {
    render(<Input aria-label="Page title" error />)

    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('disables itself while loading', () => {
    render(<Input aria-label="Search notes" loading />)

    const input = screen.getByRole('textbox', { name: 'Search notes' })
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('aria-busy', 'true')
  })
})
