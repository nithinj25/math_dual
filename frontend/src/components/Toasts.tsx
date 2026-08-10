export interface Toast {
  id: number;
  text: string;
  kind?: "good" | "bad" | "them" | "";
  icon?: string;
}

export default function Toasts({ items }: { items: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ""}`}>
          {t.icon && <span aria-hidden="true">{t.icon}</span>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
