import React from 'react';
import { twMerge } from 'tailwind-merge'

/**
 * Button component that renders a button with different styles based on the
 * variant prop. It supports click events, disabled state, and custom classes.
 * @param {Object} props - The component props.
 * @param {Function} props.onClick - Function to call when the button is clicked.
 * @param {React.ReactNode} props.children - The content to display inside the button.
 * @param {boolean} props.disabled - Whether the button is disabled.
 * @param {string} props.variant - The variant of the button (default, outline, text).
 * @param {string} props.className - Additional classes to apply to the button.
 * @param {("button"|"submit"|"reset")} [props.type] - Type attribute forwarded to the native button.
 * @param {React.Ref<HTMLButtonElement>} ref - Ref forwarded to the underlying button element.
 * Any additional props are spread onto the native button element via the rest operator.
 * @returns {React.ForwardRefExoticComponent} - A button component with different styles based on the variant prop.
 */
const Button = React.forwardRef(({
    onClick,
    children,
    disabled,
    variant = 'default',
    className,
    type = 'button',
    ...rest
}, ref) => {

    let style = '';

    // Set the button style based on the variant prop, with default to 'default'
    if (variant === 'outline') {
        style = 'border border-blue-500 text-blue-500 rounded hover:bg-blue-500 hover:text-white';    
    }
    else if (variant === 'text') {
        style = 'text-blue-500 hover:bg-blue-500 hover:text-white hover:rounded';
    }
    else if (variant === 'default') {
        style = 'bg-blue-500 text-white rounded hover:bg-blue-600';
    }
    else {
        console.warn(`Unknown variant: ${variant}`);
    }

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
    );
});

Button.displayName = 'Button';

export default Button;
