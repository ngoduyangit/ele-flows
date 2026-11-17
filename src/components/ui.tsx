import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ */
/* Buttons                                                            */
/* ------------------------------------------------------------------ */

type Variant = 'ghost' | 'primary' | 'outline'
type Size = 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm' | 'icon-xs'

const variants: Record<Variant, string> = {
  ghost:
    'bg-transparent text-foreground hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-200 data-[state=on]:bg-gray-alpha-200 active:bg-gray-alpha-200',
  primary: 'bg-foreground text-background hover:bg-gray-800 active:bg-gray-700 data-[state=open]:bg-gray-700 disabled:bg-gray-400',
  outline: 'bg-background border border-gray-alpha-200 text-foreground hover:bg-gray-50 shadow-natural-xs',
}
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2 text-xm rounded-lg',
  sm: 'h-8 px-2.5 text-sm rounded-lg',
  md: 'h-9 px-3 text-sm rounded-[10px]',
  icon: 'h-9 w-9 rounded-[10px]',
  'icon-sm': 'h-8 w-8 rounded-lg',
  'icon-xs': 'h-7 w-7 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'relative inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-75 focus-ring select-none disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
})

/* ------------------------------------------------------------------ */
/* Tooltip                                                            */
/* ------------------------------------------------------------------ */

export function Tip({ label, shortcut, children, side = 'top' }: { label: ReactNode; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root delayDuration={400}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-[100] rounded-lg bg-foreground px-2 py-1 text-xs font-medium text-background animate-pop flex items-center gap-1.5"
        >
          {label}
          {shortcut && <span className="text-gray-400">{shortcut}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Menus                                                              */
/* ------------------------------------------------------------------ */

export const menuContentCls =
  'z-[90] min-w-[160px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto overscroll-contain rounded-xl bg-popover p-1 shadow-popover animate-pop outline-none text-sm text-foreground'
export const menuItemCls =
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-lg px-2 outline-none data-[highlighted]:bg-gray-alpha-100 data-[disabled]:text-subtle data-[disabled]:pointer-events-none'

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ children, align = 'start', side = 'bottom', className, sideOffset = 6 }: { children: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string; sideOffset?: number }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} side={side} sideOffset={sideOffset} collisionPadding={8} className={cn(menuContentCls, className)} onCloseAutoFocus={(e) => e.preventDefault()}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

export function MenuItem({ children, shortcut, icon, onSelect, disabled, danger }: { children: ReactNode; shortcut?: string; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <DropdownMenu.Item className={cn(menuItemCls, danger && 'text-red-600')} onSelect={onSelect} disabled={disabled}>
      {icon && <span className="text-secondary [&_svg]:w-4 [&_svg]:h-4">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 text-xs text-subtle tabular-nums">{shortcut}</span>}
    </DropdownMenu.Item>
  )
}

export function MenuCheckItem({ children, checked, onSelect, description }: { children: ReactNode; checked: boolean; onSelect: () => void; description?: string }) {
  return (
    <DropdownMenu.Item className={cn(menuItemCls, description && 'h-auto py-1.5')} onSelect={onSelect}>
      <span className="flex-1 min-w-0">
        <span className="block truncate">{children}</span>
        {description && <span className="block text-xs text-subtle whitespace-normal">{description}</span>}
      </span>
      <Check className={cn('w-4 h-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
    </DropdownMenu.Item>
  )
}

export const MenuSeparator = () => <DropdownMenu.Separator className="my-1 h-px bg-gray-alpha-150 mx-1" />
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">{children}</DropdownMenu.Label>
)

/* ------------------------------------------------------------------ */
/* Select pill (used in node footers)                                 */
/* ------------------------------------------------------------------ */

export interface Option<T extends string | number> {
  value: T
  label: string
  description?: string
}

export function SelectPill<T extends string | number>({
  value,
  options,
  onChange,
  icon,
  title,
  chevron,
  render,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  icon?: ReactNode
  title?: string
  chevron?: boolean
  render?: (o: Option<T> | undefined) => ReactNode
}) {
  const cur = options.find((o) => o.value === value)
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="nodrag flex h-8 items-center gap-1 rounded-[10px] px-2 text-sm font-medium text-foreground whitespace-nowrap hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-200 focus-ring transition-colors duration-75"
        >
          {icon && <span className="[&_svg]:w-4 [&_svg]:h-4">{icon}</span>}
          <span className="tabular-nums">{render ? render(cur) : (cur?.label ?? String(value))}</span>
          {chevron && <ChevronDown className="w-4 h-4 text-secondary" strokeWidth={1.5} />}
        </button>
      </MenuTrigger>
      <MenuContent align="center">
        {title && <MenuLabel>{title}</MenuLabel>}
        {options.map((o) => (
          <MenuCheckItem key={String(o.value)} checked={o.value === value} onSelect={() => onChange(o.value)} description={o.description}>
            {o.label}
          </MenuCheckItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

/* ------------------------------------------------------------------ */
/* Switch                                                             */
/* ------------------------------------------------------------------ */

export function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="nodrag relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors data-[state=checked]:bg-foreground focus-ring"
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Popover helpers                                                    */
/* ------------------------------------------------------------------ */

export const PopoverRoot = Popover.Root
export const PopoverTrigger = Popover.Trigger
export const PopoverAnchor = Popover.Anchor
export function PopoverContent({ children, className, align = 'start', side = 'bottom', sideOffset = 8, onOpenAutoFocus }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; sideOffset?: number; onOpenAutoFocus?: (e: Event) => void }) {
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={12}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn('z-[90] rounded-2xl bg-popover shadow-popover animate-pop outline-none', className)}
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  )
}

export const Divider = ({ className }: { className?: string }) => <div className={cn('w-px h-5 bg-gray-alpha-200 mx-1', className)} />

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="text-xs text-subtle tabular-nums">{children}</span>
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl+'
