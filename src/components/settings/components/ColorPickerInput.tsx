export const ColorPickerInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) => {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      <div className="flex h-10 w-[150px] items-center gap-2 rounded-lg border border-input-border bg-input px-3 text-sm transition-colors focus-within:border-accent">
        <label
          className="relative w-4 h-4 rounded border border-black/10 shrink-0 cursor-pointer overflow-hidden"
          style={{ backgroundColor: value }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full scale-150"
            aria-label={`Select ${label} color`}
          />
        </label>
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="w-full bg-transparent border-none focus:outline-none text-text-primary text-xs font-mono"
          placeholder="#000000"
          aria-label={`${label} hex code`}
        />
      </div>
    </div>
  );
};
