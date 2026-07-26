export interface ToggleSwitchProps {
  checked: boolean;
  label?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** Small LED-style toggle used inside plugin panels. */
export function ToggleSwitch({ checked, label, disabled = false, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex flex-col items-center gap-1.5 select-none group ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`w-9 h-5 rounded-full border transition-colors relative ${
          checked ? 'bg-[#E8A030]/20 border-[#E8A030]/70' : 'bg-[#161616] border-[#2E2E2E]'
        }`}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all ${
            checked
              ? 'left-[18px] bg-[#E8A030] shadow-[0_0_6px_rgba(232,160,48,0.8)]'
              : 'left-[3px] bg-[#3A3A3A]'
          }`}
        />
      </span>
      {label && (
        <span className={`text-[10px] uppercase tracking-wider ${checked ? 'text-[#E8A030]' : 'text-muted-foreground'}`}>
          {label}
        </span>
      )}
    </button>
  );
}
