type Props = {
  children: React.ReactNode;
  pending: boolean;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
};

const VARIANT_CLASS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
} as const;

export default function SubmitButton({
  children,
  pending,
  pendingText = "Đang xử lý...",
  variant = "primary",
  className = "",
}: Props) {
  return (
    <button type="submit" disabled={pending} className={`${VARIANT_CLASS[variant]} ${className}`}>
      {pending ? pendingText : children}
    </button>
  );
}
