import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('calls its action when enabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save note</Button>)

    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disables itself while loading', () => {
    render(<Button loading>Save note</Button>)

    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled()
  })
})
