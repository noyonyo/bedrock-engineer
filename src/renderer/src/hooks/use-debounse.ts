import { useState, useEffect } from 'react'

export function useDebounce(value: any, delay: number) {
  // State and setter to debounce
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    // Update the state to debounce after delay
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    // Cancel timer just before the next effect runs
    return () => {
      clearTimeout(timer)
    }

    // Execute effect every time value or delay updates
  }, [value, delay])

  // Return the final updated state
  return debouncedValue
}
