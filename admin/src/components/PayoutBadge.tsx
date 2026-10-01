interface Props {
  amount?: string | null;
  monthYear: string;
}

function formatAmount(val: string): string {
  const n = parseFloat(val.replace(/[^\d.,]/g, "").replace(/^\./, "").replace(/,/g, ""));
  if (isNaN(n) || n === 0) return val;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function PayoutBadge({ amount, monthYear }: Props) {
  const [year, month] = monthYear.split("-");
  const label = new Date(Number(year), Number(month) - 1).toLocaleString("en", {
    month: "short",
    year: "numeric",
  });

  if (!amount) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
        {label} — pending
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      {formatAmount(amount)}
    </span>
  );
}
