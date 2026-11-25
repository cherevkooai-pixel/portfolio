"use client";

export function CelebratoryModal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background px-6">
      <div className="animate-celebrate flex flex-col items-center gap-6 text-center">
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-accent px-8 py-3 text-sm font-medium text-accent-foreground shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        Continue
      </button>
    </div>
  );
}
