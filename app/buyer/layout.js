export const metadata = {
  title: "Buyer Demo",
  description: "An AI-assisted buyer checkout experience.",
};

export default function BuyerLayout({ children }) {
  return <main className="min-h-screen bg-[var(--background)]">{children}</main>;
}