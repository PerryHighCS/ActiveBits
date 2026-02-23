import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { resolveButtonVariantClass, type ButtonVariant } from './buttonStyles'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode
  variant?: ButtonVariant | string
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ onClick, children, disabled, variant = 'default', className, type = 'button', ...rest }, ref) => {
    const style = resolveButtonVariantClass(variant)

    return (
      <button
        ref={ref}
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={twMerge(`px-4 py-2 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`, style, className)}
        {...rest}
      >
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'

export default Button
