type ButtonVariant = 'default' | 'outline' | 'text'

export function resolveButtonVariantClass(
  variant: ButtonVariant | string,
  warn: (message: string) => void = console.warn,
): string {
  if (variant === 'outline') {
    return 'border border-blue-500 text-blue-500 rounded hover:bg-blue-500 hover:text-white'
  }
  if (variant === 'text') {
    return 'text-blue-500 hover:bg-blue-500 hover:text-white hover:rounded'
  }
  if (variant === 'default') {
    return 'bg-blue-500 text-white rounded hover:bg-blue-600'
  }

  warn(`Unknown variant: ${variant}`)
  return ''
}
