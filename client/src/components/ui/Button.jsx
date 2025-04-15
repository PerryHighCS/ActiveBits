import React from 'react';
import { twMerge } from 'tailwind-merge'

const Button = ({ onClick, children, disabled, variant, className }) => {
    variant = variant || 'default';

    let style = '';

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
