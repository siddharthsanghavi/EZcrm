'use client';

/**
 * A submit button that asks first.
 *
 * Deleting a company takes its contacts, activity and tasks with it, and there
 * is no undo — so the one thing worth adding over a plain <button> is a beat
 * between the click and the write. Without JavaScript it degrades to exactly
 * that plain button, which is the same behaviour this app had before.
 */
export function ConfirmButton({
  message,
  className,
  name,
  value,
  children,
}: {
  message: string;
  className?: string;
  name?: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      name={name}
      value={value}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
