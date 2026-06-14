import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex min-w-0 rounded-md border bg-transparent text-base shadow-xs outline-none transition-[color,box-shadow] disabled:pointer-events-none disabled:cursor-default disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
