import { type ReactElement, cloneElement, useId } from "react";

type Props = {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
};

/** Labelled form control; wires id, aria-invalid and aria-describedby onto its child. */
export function Field({ label, error, hint, className = "", children }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error || hint ? noteId : undefined,
      })}
      {error ? (
        <span id={noteId} className="field-error">
          {error}
        </span>
      ) : (
        hint && (
          <span id={noteId} className="field-hint">
            {hint}
          </span>
        )
      )}
    </div>
  );
}
