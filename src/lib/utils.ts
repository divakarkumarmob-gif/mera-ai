import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function stripLatexForTTS(text: string): string {
  return text
    .replace(/\*+/g, '')
    .replace(/#/g, '')
    .replace(/\$/g, '')
    .replace(/\\cdot/g, ' dot ')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2')
    .replace(/\\sqrt\{([^}]+)\}/g, 'square root of $1')
    .replace(/\\sum/g, 'sum ')
    .replace(/\\int/g, 'integral ')
    .replace(/\\alpha/g, 'alpha ')
    .replace(/\\beta/g, 'beta ')
    .replace(/(\w+)\^\{([^}]+)\}/g, '$1 to the power of $2')
    .replace(/(\w+)_\{([^}]+)\}/g, '$1 sub $2')
    .replace(/\\/g, ' ')
    .replace(/\{|\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
