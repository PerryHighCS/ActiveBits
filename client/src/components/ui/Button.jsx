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
 * @returns {React.Component} - A button component with different styles based on the variant prop.
 */
const Button = ({ onClick, children, disabled, variant, className }) => {
    variant = variant || 'default';

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
            onClick={onClick}
            disabled={disabled}
            className={twMerge(className, `px-4 py-2 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`, style)}
        >
            {children}
        </button>
    );
}

export default Button;
