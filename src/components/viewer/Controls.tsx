import { Children, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ComponentProps, InputHTMLAttributes, KeyboardEvent, OptionHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

type ClassNameValue = string | false | null | undefined;

function cn(...values: ClassNameValue[]): string {
  return values.filter(Boolean).join(' ');
}

type ViewerButtonProps = ComponentProps<'button'>;

export function ViewerButton({ className, ...props }: ViewerButtonProps) {
  return (
    <button
      type="button"
      className={cn('viewer-button', className)}
      {...props}
    />
  );
}

interface ViewerSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children?: ReactNode;
  controlClassName?: string;
  small?: boolean;
}

interface ViewerSelectOption {
  value: string;
  label: string;
  hidden: boolean;
  disabled: boolean;
}

function getOptionText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getOptionText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getOptionText(node.props.children);
  return '';
}

function getSelectOptions(children: ReactNode): ViewerSelectOption[] {
  const options: ViewerSelectOption[] = [];

  function visit(nodes: ReactNode): void {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return;
      if (child.type === Fragment) {
        visit(child.props.children);
        return;
      }
      if (child.type !== 'option') return;

      const label = child.props.label
        ? String(child.props.label)
        : getOptionText(child.props.children).trim();
      options.push({
        value: child.props.value === undefined ? label : String(child.props.value),
        label,
        hidden: Boolean(child.props.hidden),
        disabled: Boolean(child.props.disabled),
      });
    });
  }

  visit(children);
  return options;
}

export function ViewerSelect({
  children,
  controlClassName,
  small = false,
  ...selectProps
}: ViewerSelectProps) {
  const controlRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fallbackValue, setFallbackValue] = useState(
    String(selectProps.defaultValue ?? ''),
  );
  const options = useMemo(() => getSelectOptions(children), [children]);
  const selectedValue = Array.isArray(selectProps.value)
    ? String(selectProps.value[0] ?? '')
    : String(selectProps.value ?? fallbackValue);
  const selectedOption = options.find(option => option.value === selectedValue);
  const selectedLabel = selectedOption?.label ?? '';
  const menuId = selectProps.id ? `${selectProps.id}-menu` : undefined;
  const observedValue = Array.isArray(selectProps.value)
    ? selectProps.value.join('\u0000')
    : selectedValue;
  const disabled = Boolean(selectProps.disabled);
  const visibleOptions = useMemo(() => options.filter(option => !option.hidden), [options]);

  const positionMenu = useCallback(() => {
    const control = controlRef.current;
    const menu = menuRef.current;
    if (!control || !menu) return;

    const viewportPadding = 8;
    const menuGap = 6;
    const controlRect = control.getBoundingClientRect();
    const menuMinWidth = Math.max(138, Math.round(controlRect.width));
    menu.style.setProperty('--select-menu-min-width', `${menuMinWidth}px`);
    menu.style.setProperty(
      '--select-menu-max-height',
      `${Math.max(96, window.innerHeight - viewportPadding * 2)}px`,
    );
    menu.style.removeProperty('--select-menu-width');

    const optionWidth = Math.max(
      menuMinWidth,
      ...Array.from(menu.querySelectorAll('button')).map(button => button.scrollWidth + 10),
    );
    const menuWidth = Math.min(
      Math.ceil(optionWidth),
      window.innerWidth - viewportPadding * 2,
    );
    menu.style.setProperty('--select-menu-width', `${menuWidth}px`);

    const menuRect = menu.getBoundingClientRect();
    const menuHeight = menuRect.height || 0;
    const maxLeft = window.innerWidth - viewportPadding - menuWidth;
    const left = Math.max(viewportPadding, Math.min(controlRect.left, maxLeft));

    const belowTop = controlRect.bottom + menuGap;
    const aboveTop = controlRect.top - menuGap - menuHeight;
    const hasMoreSpaceAbove =
      controlRect.top - viewportPadding > window.innerHeight - controlRect.bottom - viewportPadding;
    const top =
      belowTop + menuHeight <= window.innerHeight - viewportPadding || !hasMoreSpaceAbove
        ? Math.min(belowTop, window.innerHeight - viewportPadding - menuHeight)
        : aboveTop;

    menu.style.setProperty('--select-menu-left', `${Math.round(left)}px`);
    menu.style.setProperty(
      '--select-menu-top',
      `${Math.round(Math.max(viewportPadding, top))}px`,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
  }, [open, positionMenu, visibleOptions, selectedValue]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (controlRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const reposition = () => positionMenu();

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectOption = useCallback((value: string) => {
    setFallbackValue(value);
    selectProps.onChange?.({
      currentTarget: { value },
      target: { value },
    } as unknown as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    requestAnimationFrame(() => controlRef.current?.focus());
  }, [selectProps]);

  const toggleMenu = useCallback(() => {
    if (disabled || visibleOptions.length === 0) return;
    setOpen(value => !value);
  }, [disabled, visibleOptions.length]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (!disabled && visibleOptions.length > 0) setOpen(true);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }, [disabled, visibleOptions.length]);

  return (
    <span
      ref={controlRef}
      data-slot="select-control"
      className={cn(
        'select-control',
        small && 'select-control-small',
        open && 'is-open',
        disabled && 'is-disabled',
        !selectedLabel && 'is-empty',
        controlClassName,
      )}
      role="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={event => {
        event.preventDefault();
        toggleMenu();
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="select-control-value" title={selectedLabel}>
        {selectedLabel || '\u00a0'}
      </span>
      <select {...selectProps} ref={selectRef} tabIndex={-1} data-slot="select" data-value={observedValue}>
        {children}
      </select>
      <span className="select-control-caret">▾</span>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="select-menu"
          role="listbox"
          onPointerDown={event => event.stopPropagation()}
        >
          {visibleOptions.map(option => (
            <button
              key={option.value}
              type="button"
              className={cn(option.value === selectedValue && 'active')}
              disabled={option.disabled}
              role="option"
              aria-selected={option.value === selectedValue}
              title={option.label}
              onClick={(event) => {
                event.stopPropagation();
                if (!option.disabled) selectOption(option.value);
              }}
            >
              {option.label || '\u00a0'}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

interface ViewerCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children: ReactNode;
}

export function ViewerCheckbox({
  children,
  className,
  ...inputProps
}: ViewerCheckboxProps) {
  return (
    <label className={cn('viewer-checkbox', className)}>
      <input type="checkbox" {...inputProps} />
      <span className="viewer-checkbox-box" aria-hidden="true">
        <Check />
      </span>
      <span className="viewer-checkbox-label">{children}</span>
    </label>
  );
}

type ViewerInputProps = ComponentProps<'input'>;

export function ViewerInput({ className, ...props }: ViewerInputProps) {
  return <input className={cn('viewer-input', className)} {...props} />;
}
