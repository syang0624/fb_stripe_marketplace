function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AuthAccountMenu({ label }: { label: string }) {
  return (
    <div className="ml-4 flex items-center gap-2 border-l border-line pl-4">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-steel text-xs font-semibold text-ink"
      >
        {initials(label) || "U"}
      </span>
      <div className="hidden min-w-0 sm:block">
        <p className="max-w-32 truncate text-xs font-medium text-ink">{label}</p>
        <a
          href="/auth/logout"
          className="text-[11px] text-ink/50 transition-colors hover:text-ink"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
